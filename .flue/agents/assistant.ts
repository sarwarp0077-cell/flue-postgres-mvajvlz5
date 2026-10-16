import type { FlueContext } from '@flue/sdk/client';
import * as v from 'valibot';
import { sessionStore } from '../session-store';


export const triggers = { webhook: true };

const Payload = v.object({
	message: v.optional(v.string(), 'Say hi and briefly introduce yourself in one sentence.'),
});

export default async function ({ init, payload, env }: FlueContext) {
	const { message } = v.parse(Payload, payload ?? {});

	const agent = await init({
		model: env.MODEL_ID ?? 'anthropic/claude-sonnet-4-6',
		persist: sessionStore,
	});

	// The session ID matches the request URL's last path segment, so
	// repeated POSTs to /agents/assistant/<id> continue the same thread.
	const session = await agent.session();

	const reply = await session.prompt(message);

	return { reply: reply.text };
}
