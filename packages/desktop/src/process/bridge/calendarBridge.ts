import { ipcBridge } from '@/common';
import type {
  CalendarEventCreateInput,
  CalendarEventUpdateInput,
  CalendarRangeQuery,
  CalendarScope,
  ScheduleBlockCreateInput,
  ScheduleBlockUpdateInput,
} from '@/common/types/searcht/calendar';
import { getPersonalDatabase } from '@process/services/personal-core';
import { CalendarService } from '@process/services/personal-core/CalendarService';

type Service = Pick<
  CalendarService,
  | 'listEvents'
  | 'getEvent'
  | 'createEvent'
  | 'updateEvent'
  | 'removeEvent'
  | 'restoreEvent'
  | 'destroyEvent'
  | 'emptyTrash'
  | 'listBlocks'
  | 'createBlock'
  | 'updateBlock'
  | 'removeBlock'
  | 'restoreBlock'
  | 'destroyBlock'
  | 'getToday'
>;
export type CalendarBridgeDependencies = { service: Service };

export function initCalendarBridge(dependencies?: CalendarBridgeDependencies) {
  const service = (): Service => dependencies?.service ?? new CalendarService(getPersonalDatabase().driver);
  const handlers = {
    list: async (query: CalendarRangeQuery) => service().listEvents(query),
    get: async (id: string) => service().getEvent(id),
    create: async (input: CalendarEventCreateInput) => service().createEvent(input),
    update: async (input: CalendarEventUpdateInput, scope?: CalendarScope) => service().updateEvent(input, scope),
    remove: async (id: string, scope?: CalendarScope) => service().removeEvent(id, scope),
    restore: async (id: string) => service().restoreEvent(id),
    destroy: async (id: string) => service().destroyEvent(id),
    emptyTrash: async () => ({ removed: service().emptyTrash() }),
    listBlocks: async (query: CalendarRangeQuery) => service().listBlocks(query),
    createBlock: async (input: ScheduleBlockCreateInput) => service().createBlock(input),
    updateBlock: async (input: ScheduleBlockUpdateInput) => service().updateBlock(input),
    removeBlock: async (id: string) => service().removeBlock(id),
    restoreBlock: async (id: string) => service().restoreBlock(id),
    destroyBlock: async (id: string) => service().destroyBlock(id),
    getToday: async (localDate: string) => service().getToday(localDate),
    getNotificationCapability: async () => ({
      available: true,
      permission: 'granted' as const,
      backgroundReliable: true,
    }),
  };
  ipcBridge.calendar.list.provider(handlers.list);
  ipcBridge.calendar.get.provider(({ id }) => handlers.get(id));
  ipcBridge.calendar.create.provider(handlers.create);
  ipcBridge.calendar.update.provider((input) => handlers.update(input, input.scope));
  ipcBridge.calendar.remove.provider(({ id, scope }) => handlers.remove(id, scope));
  ipcBridge.calendar.restore.provider(({ id }) => handlers.restore(id));
  ipcBridge.calendar.destroy.provider(({ id }) => handlers.destroy(id));
  ipcBridge.calendar.emptyTrash.provider(handlers.emptyTrash);
  ipcBridge.calendar.listBlocks.provider(handlers.listBlocks);
  ipcBridge.calendar.createBlock.provider(handlers.createBlock);
  ipcBridge.calendar.updateBlock.provider(handlers.updateBlock);
  ipcBridge.calendar.removeBlock.provider(({ id }) => handlers.removeBlock(id));
  ipcBridge.calendar.restoreBlock.provider(({ id }) => handlers.restoreBlock(id));
  ipcBridge.calendar.destroyBlock.provider(({ id }) => handlers.destroyBlock(id));
  ipcBridge.calendar.getToday.provider(({ localDate }) => handlers.getToday(localDate));
  ipcBridge.calendar.getNotificationCapability.provider(handlers.getNotificationCapability);
  return handlers;
}
