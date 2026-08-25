import type {
  InboxConversionResult,
  InboxEventConversionInput,
  InboxTaskConversionInput,
} from '@/common/types/searcht/inbox';
import type { CalendarEventCreateInput } from '@/common/types/searcht/calendar';
import type { TaskCreateInput } from '@/common/types/searcht/tasks';
import type { InboxConversionOperation, InboxDatabase } from './inboxDb';

const COMPLETED_OPERATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type ConversionTargetAdapter<TInput> = {
  get(id: string): Promise<{ id: string } | null>;
  create(input: TInput, id: string): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
};

export type InboxConversionSagaOptions = {
  database: InboxDatabase;
  taskAdapter: ConversionTargetAdapter<TaskCreateInput>;
  eventAdapter: ConversionTargetAdapter<CalendarEventCreateInput>;
  now?: () => number;
};

export function createInboxConversionSaga(options: InboxConversionSagaOptions) {
  const now = options.now ?? Date.now;

  const adapterFor = (operation: InboxConversionOperation): ConversionTargetAdapter<never> =>
    (operation.targetType === 'task' ? options.taskAdapter : options.eventAdapter) as ConversionTargetAdapter<never>;

  const compensate = async (operation: InboxConversionOperation): Promise<void> => {
    const compensating =
      operation.status === 'compensating' ? operation : await options.database.markConversionCompensating(operation.id);
    await adapterFor(compensating).remove(compensating.targetId);
    await options.database.finishConversionCompensation(compensating.id);
  };

  const recover = async (operation: InboxConversionOperation): Promise<InboxConversionResult | null> => {
    if (operation.status === 'compensating') {
      await compensate(operation);
      return null;
    }
    try {
      const adapter = adapterFor(operation);
      const existing = await adapter.get(operation.targetId);
      if (!existing) await adapter.create(operation.target as never, operation.targetId);
      return await options.database.completeConversion(operation.id);
    } catch (error) {
      await compensate(operation);
      throw error;
    }
  };

  const reconcile = async (): Promise<void> => {
    const incomplete = await options.database.listIncompleteConversions();
    await incomplete.reduce<Promise<void>>(
      (previous, operation) =>
        previous.then(async (): Promise<void> => {
          await recover(operation);
        }),
      Promise.resolve()
    );
    await options.database.pruneCompletedConversions(now() - COMPLETED_OPERATION_RETENTION_MS);
  };

  const convertToTask = async (input: InboxTaskConversionInput): Promise<InboxConversionResult> => {
    await reconcile();
    const operation = await options.database.prepareConversion({ ...input, targetType: 'task' });
    if (operation.status === 'completed') return options.database.completeConversion(operation.id);
    const result = await recover(operation);
    if (!result) throw new Error('INBOX_OPERATION_COMPENSATED');
    return result;
  };

  const convertToEvent = async (input: InboxEventConversionInput): Promise<InboxConversionResult> => {
    await reconcile();
    const operation = await options.database.prepareConversion({ ...input, targetType: 'calendar-event' });
    if (operation.status === 'completed') return options.database.completeConversion(operation.id);
    const result = await recover(operation);
    if (!result) throw new Error('INBOX_OPERATION_COMPENSATED');
    return result;
  };

  return { convertToTask, convertToEvent, reconcile };
}
