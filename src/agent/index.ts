import { generateText, type LanguageModel } from "ai";
import type { AgentContext } from "../core/agent-context.js";
import { systemPrompt } from "./prompts.js";

export interface AgentDecision {
  requiresSandbox: boolean;
  prompt?: string;
  response?: string;
  reasoning: string;
}

export interface AgentDeps {
  model: LanguageModel;
}

export const decide = async (
  deps: AgentDeps,
  context: AgentContext
): Promise<AgentDecision> => {
  const prompt = buildDecisionPrompt(context);

  const result = await generateText({
    model: deps.model,
    system: systemPrompt,
    prompt
  });

  return parseDecision(result.text);
};

const buildDecisionPrompt = (context: AgentContext): string => {
  const slack = context.slack;
  const sandbox = context.sandbox;

  return `
# Current Context

## Slack Context
- Channel: #${slack.channel.name} (${slack.channel.type})
- Thread: ${slack.thread.id}
- Participants: ${slack.thread.participants.join(", ") || "none"}
- Current Message: "${slack.currentMessage.text}"
- Author: @${slack.currentMessage.author}

## Conversation History (${slack.history.length} messages)
${slack.history.map(h => `- ${h.role}: ${h.content.substring(0, 100)}${h.content.length > 100 ? "..." : ""}`).join("\n") || "No previous messages"}

## Sandbox Context
- Active Session: ${sandbox.sessionId ? "Yes" : "No"}
${sandbox.sessionId ? `- Session ID: ${sandbox.sessionId}` : ""}
- Execution History: ${sandbox.executionHistory.length} commands
${sandbox.executionHistory.length > 0 ? sandbox.executionHistory.slice(-3).map(e => `  - ${e.command.substring(0, 80)} (${e.success ? "success" : "failed"})`).join("\n") : "  None"}

## Task
Based on the user's message and context, decide what action to take.

If the user is asking for:
- Information that requires running commands (gh, nr, aws, etc.)
- Code execution or file operations
- System checks or deployments
→ Set requiresSandbox: true and provide a detailed prompt

If the user is asking for:
- Simple questions that don't need commands
- Clarifications or general conversation
- Help with syntax or commands
→ Set requiresSandbox: false and provide a direct response

Respond in this JSON format:
{
  "requiresSandbox": boolean,
  "prompt": "string (if requiresSandbox)",
  "response": "string (if !requiresSandbox)",
  "reasoning": "string explaining your decision"
}
`;
};

const parseDecision = (text: string): AgentDecision => {
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        requiresSandbox: parsed.requiresSandbox ?? true,
        prompt: parsed.prompt,
        response: parsed.response,
        reasoning: parsed.reasoning || "No reasoning provided"
      };
    }
  } catch {
    // Fallback: if parsing fails, assume sandbox is needed
  }

  // Fallback decision
  return {
    requiresSandbox: true,
    prompt: text,
    reasoning: "Fallback: could not parse decision, defaulting to sandbox execution"
  };
};
