import { describe, expect, it, vi } from 'vitest';
import { CollaborationService } from '@process/services/personal-core/content/collaboration/CollaborationService';

const validInput = {
  messageId: 'message-1',
  teamId: 'team-1',
  content: '  Prepare the report  ',
  targetMode: 'members' as const,
  targetSlotIds: ['codex', 'codex'],
  fileRefs: [{ kind: 'local' as const, path: 'C:\\reports\\input.docx' }],
};

describe('CollaborationService', () => {
  it('normalizes content and target slots before persistence', () => {
    const repository = { createInstruction: vi.fn(() => ({ messages: [], deliveries: [] })) };
    const service = new CollaborationService(repository);

    service.createInstruction(validInput);

    expect(repository.createInstruction).toHaveBeenCalledWith({
      ...validInput,
      content: 'Prepare the report',
      targetSlotIds: ['codex'],
    });
  });

  it('rejects blank content without writing', () => {
    const repository = { createInstruction: vi.fn() };
    const service = new CollaborationService(repository);

    expect(() => service.createInstruction({ ...validInput, content: '   ' })).toThrow(
      'COLLABORATION_CONTENT_REQUIRED'
    );
    expect(repository.createInstruction).not.toHaveBeenCalled();
  });

  it('rejects invalid persisted file references without writing', () => {
    const repository = { createInstruction: vi.fn() };
    const service = new CollaborationService(repository);

    expect(() =>
      service.createInstruction({ ...validInput, fileRefs: [{ kind: 'local', path: 42 }] as never })
    ).toThrow('COLLABORATION_FILE_REF_INVALID');
    expect(repository.createInstruction).not.toHaveBeenCalled();
  });

  it('rejects more than 32 unique targets', () => {
    const repository = { createInstruction: vi.fn() };
    const service = new CollaborationService(repository);

    expect(() =>
      service.createInstruction({
        ...validInput,
        targetSlotIds: Array.from({ length: 33 }, (_, index) => `slot-${index}`),
      })
    ).toThrow('COLLABORATION_TARGET_LIMIT_EXCEEDED');
  });
});
