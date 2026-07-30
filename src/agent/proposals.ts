import type { Logger } from '../core/logger.js';
import type { Reporter } from '../core/reporter.js';
import type { Repository } from '../storage/repository.js';
import type { IntentDetector } from './intent.js';
import type { AgentRunner } from './runner.js';

export interface ProposalServiceDeps {
  repository: Repository;
  reporter: Reporter;
  intent: IntentDetector;
  runner: AgentRunner;
  logger: Logger;
}

export class ProposalService {
  public constructor(private readonly deps: ProposalServiceDeps) {}

  public async considerMessage(input: {
    userId: number | null;
    text: string;
  }): Promise<void> {
    const detected = await this.deps.intent.detect(input.text);
    if (!detected.isProposal) {
      return;
    }

    const approval = await this.deps.repository.createApproval({
      requestedBy: input.userId,
      kind: detected.kind,
      stage: 'idea',
      summary: detected.title,
      payload: { summary: detected.summary, idea: input.text },
    });

    const text = [
      `Proposal #${approval.id} (${detected.kind})`,
      detected.title,
      '',
      detected.summary,
      '',
      'Tap a button below to plan it or drop it.',
    ].join('\n');

    await this.deps.reporter.postProposal(text, approval.id);
  }
}
