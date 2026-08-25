export type IcsParsedEvent = {
  uid: string;
  summary: string;
  description: string;
  location: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startLocalDate: string;
  endLocalDate: string;
  recurring: boolean;
};

export type IcsParseResult = {
  events: IcsParsedEvent[];
  skipped: number;
};

function unfold(content: string): string[] {
  const lines = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }
    unfolded.push(line);
  }
  return unfolded;
}

function splitProperty(line: string): { name: string; params: string[]; value: string } | null {
  const separator = line.indexOf(':');
  if (separator < 0) return null;
  const left = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const [name, ...params] = left.split(';');
  if (!name) return null;
  return { name: name.toUpperCase(), params: params.map((param) => param.toUpperCase()), value };
}

function unescapeText(value: string): string {
  return value
    .replaceAll('\\n', '\n')
    .replaceAll('\\N', '\n')
    .replaceAll('\\,', ',')
    .replaceAll('\\;', ';')
    .replaceAll('\\\\', '\\');
}

function parseIcsDate(
  value: string,
  params: string[]
): { allDay: boolean; localDate: string; iso: string | null } | null {
  const dateOnly = params.includes('VALUE=DATE') || /^\d{8}$/.test(value);
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return null;
  const [, year, month, day, hour = '00', minute = '00', second = '00', utc] = match;
  if (dateOnly || !match[4]) {
    return { allDay: true, localDate: `${year}-${month}-${day}`, iso: null };
  }
  const date = utc
    ? new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)))
    : new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (Number.isNaN(date.getTime())) return null;
  return { allDay: false, localDate: localDateOf(date), iso: date.toISOString() };
}

function localDateOf(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseIcsCalendar(content: string): IcsParseResult {
  const lines = unfold(content);
  const events: IcsParsedEvent[] = [];
  let skipped = 0;
  let inEvent = false;
  let current: Record<string, string> = {};
  let currentParams: Record<string, string[]> = {};

  const pushEvent = (): void => {
    if (!current.UID) {
      skipped += 1;
      return;
    }
    const start = current.DTSTART ? parseIcsDate(current.DTSTART, currentParams.DTSTART ?? []) : null;
    if (!start) {
      skipped += 1;
      return;
    }
    const end = current.DTEND ? parseIcsDate(current.DTEND, currentParams.DTEND ?? []) : null;
    const summary = unescapeText(current.SUMMARY ?? '').trim() || 'Untitled event';
    const description = unescapeText(current.DESCRIPTION ?? '').trim();
    const recurring = Boolean(current.RRULE);
    events.push({
      uid: current.UID,
      summary,
      description:
        recurring && description ? `${description}\n(recurring series; imported as the first occurrence)` : description,
      location: unescapeText(current.LOCATION ?? '').trim(),
      allDay: start.allDay,
      startsAt: start.iso,
      endsAt: end?.iso ?? null,
      startLocalDate: start.localDate,
      endLocalDate: end?.localDate ?? start.localDate,
      recurring,
    });
  };

  for (const line of lines) {
    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
      currentParams = {};
      continue;
    }
    if (line.toUpperCase() === 'END:VEVENT') {
      if (inEvent) pushEvent();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    const property = splitProperty(line);
    if (!property) continue;
    if (['UID', 'DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'RRULE'].includes(property.name)) {
      current[property.name] = property.value;
      currentParams[property.name] = property.params;
    }
  }
  return { events, skipped };
}
