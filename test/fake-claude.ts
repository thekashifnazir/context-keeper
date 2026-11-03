// fake-claude: a scripted stand-in for the Anthropic client. Each expected call names the model it
// must be sent to and what it returns (or throws). An unexpected call, a wrong model, or a script
// left unfinished fails the test. Zero cost, no network.
import type Anthropic from '@anthropic-ai/sdk';
import type { Claude } from '../src/agent/model.ts';
import type { RoomContext } from '../src/agent/blocks.ts';

export interface Step { model: string; respond: Anthropic.Message | Error | ((params: any) => Anthropic.Message) }

export class FakeClaude implements Claude {
  calls: { model: string; params: any }[] = [];
  constructor(private script: Step[]) {}
  async create(params: Record<string, unknown>): Promise<Anthropic.Message> {
    const step = this.script.shift();
    const model = String(params.model);
    this.calls.push({ model, params });
    if (!step) throw new Error(`FakeClaude: unexpected call #${this.calls.length} to ${model}`);
    if (step.model !== model) throw new Error(`FakeClaude: call #${this.calls.length} went to ${model}, expected ${step.model}`);
    if (step.respond instanceof Error) throw step.respond;
    return typeof step.respond === 'function' ? step.respond(params) : step.respond;
  }
  /** Throws if scripted calls were never made. */
  done(): void {
    if (this.script.length) throw new Error(`FakeClaude: ${this.script.length} scripted call(s) never made`);
  }
}

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

export function message(model: string, content: any[], stop_reason = 'end_turn'): Anthropic.Message {
  return { id: 'msg_fake', type: 'message', role: 'assistant', model, content, stop_reason, stop_sequence: null, usage } as unknown as Anthropic.Message;
}

/** A cited verdict response. `cite` = [blockId, citedText override?] pairs, looked up in ctx. */
export function verdictMessage(model: string, ctx: RoomContext, items: Record<string, unknown>[], cite: { blockId: string; text?: string }[]): Anthropic.Message {
  const citations = cite.map(({ blockId, text }) => {
    for (let d = 0; d < ctx.table.length; d++) {
      const i = ctx.table[d].findIndex((b) => b.blockId === blockId);
      if (i >= 0) return { type: 'content_block_location', cited_text: text ?? ctx.table[d][i].text, document_index: d, document_title: null, start_block_index: i, end_block_index: i + 1, file_id: null };
    }
    throw new Error(`no block ${blockId}`);
  });
  const id = items[0]?.message_id;
  return message(model, [
    { type: 'text', text: `item: ${id}\nevidence: `, citations: null },
    ...(citations.length ? [{ type: 'text', text: 'the record', citations }] : []),
    { type: 'tool_use', id: 'tu_1', name: 'record_verdict', input: { items } },
  ], 'tool_use');
}

export function reviewerMessage(model: string, results: { id: string; supports: boolean; issue?: string }[]): Anthropic.Message {
  return message(model, [{ type: 'text', text: JSON.stringify({ results: results.map((r) => ({ issue: '', ...r })) }) }]);
}

export const item = (message_id: string, over: Record<string, unknown> = {}) => ({
  message_id, job: 'A', verdict: 'covered', restriction: 'none', clashes_with: '', claim: 'c', reply: 'Good news: this exists.', credit: '', embedded_instruction: false, ...over,
});
