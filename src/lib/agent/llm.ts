import { ZodError } from "zod";

import type { GraphContext } from "@/lib/agent/graph";
import type { AgentWorkflowNodes } from "@/lib/agent/workflow";
import type {
  DiscoveryResult,
} from "@/lib/agent/contracts";
import type {
  DraftOptOutInput,
  DraftOptOutOutput,
  InterpretResultOutput,
  RetrieveProcedureOutput,
  ValidateConsentInput,
  ValidateConsentOutput,
} from "@/lib/agent/graph";
import {
  draftGeneratorPrompt,
  listingClassifierPrompt,
  postExecutionVerifierPrompt,
  procedureSelectorPrompt,
  type PromptName,
  type DraftPromptInput,
  type ListingPromptInput,
  type PostExecutionPromptInput,
  type ProcedurePromptInput,
  type PromptDefinition,
} from "@/lib/agent/prompts";

export interface StructuredLlmRequest<TInput, TOutput> {
  prompt: PromptDefinition<TInput, TOutput>;
  input: TInput;
}

export interface PromptTraceEntry {
  prompt_name: PromptName;
  prompt_version: string;
}

export interface StructuredLlmAdapter {
  generateStructured<TInput, TOutput>(request: StructuredLlmRequest<TInput, TOutput>): Promise<TOutput>;
}

export interface StructuredLlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StructuredLlmTransportRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface StructuredLlmTransportResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type StructuredLlmTransport = (
  request: StructuredLlmTransportRequest,
) => Promise<StructuredLlmTransportResponse>;

export class StructuredLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredLlmError";
  }
}

export class StructuredLlmOutputValidationError extends StructuredLlmError {
  promptName: PromptName;

  issues: ZodError["issues"];

  rawOutput: unknown;

  constructor(promptName: PromptName, error: ZodError, rawOutput: unknown) {
    super(`Structured LLM output for ${promptName} failed schema validation.`);
    this.name = "StructuredLlmOutputValidationError";
    this.promptName = promptName;
    this.issues = error.issues;
    this.rawOutput = rawOutput;
    this.cause = error;
  }
}

export interface OpenAiCompatibleStructuredLlmAdapterOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  endpoint?: string;
  headers?: Record<string, string>;
  temperature?: number;
  transport?: StructuredLlmTransport;
}

interface OpenAiCompatibleChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{
        type?: string;
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

type OpenAiCompatibleMessageContent =
  | string
  | Array<{
      type?: string;
      text?: string;
    }>
  | undefined;

function buildPromptMessages<TInput, TOutput>(request: StructuredLlmRequest<TInput, TOutput>): StructuredLlmMessage[] {
  return [
    {
      role: "system",
      content: request.prompt.system,
    },
    {
      role: "user",
      content: request.prompt.buildUserPrompt(request.input),
    },
  ];
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function buildEndpointUrl(baseUrl: string, endpoint: string) {
  return `${normalizeBaseUrl(baseUrl)}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function readMessageContent(content: OpenAiCompatibleMessageContent) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
  }

  return "";
}

function parseStructuredJson(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new StructuredLlmError("Structured LLM response was empty.");
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new StructuredLlmError(
      `Structured LLM response was not valid JSON: ${error instanceof Error ? error.message : "Unknown parse error."}`,
    );
  }
}

function parsePromptOutput<TInput, TOutput>(
  prompt: PromptDefinition<TInput, TOutput>,
  structuredOutput: unknown,
): TOutput {
  try {
    return prompt.outputSchema.parse(structuredOutput);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new StructuredLlmOutputValidationError(prompt.name, error, structuredOutput);
    }

    throw error;
  }
}

function toPromptTraceEntry<TInput, TOutput>(prompt: PromptDefinition<TInput, TOutput>): PromptTraceEntry {
  return {
    prompt_name: prompt.name,
    prompt_version: prompt.version,
  };
}

type PromptBackedNode<TArgs extends unknown[], TResult> = ((...args: TArgs) => TResult) & {
  promptTrace?: PromptTraceEntry;
};

function withPromptTrace<TArgs extends unknown[], TResult, TInput, TOutput>(
  fn: (...args: TArgs) => TResult,
  prompt: PromptDefinition<TInput, TOutput>,
): PromptBackedNode<TArgs, TResult> {
  return Object.assign(fn, {
    promptTrace: toPromptTraceEntry(prompt),
  });
}

export function readPromptTrace(node: unknown): PromptTraceEntry | null {
  if (!node || typeof node !== "function") {
    return null;
  }

  const promptTrace = (node as { promptTrace?: PromptTraceEntry }).promptTrace;
  if (!promptTrace) {
    return null;
  }

  return promptTrace;
}

function createDefaultTransport(): StructuredLlmTransport {
  return async function defaultTransport(request) {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
    };
  };
}

export function createOpenAiCompatibleStructuredLlmAdapter(
  options: OpenAiCompatibleStructuredLlmAdapterOptions,
): StructuredLlmAdapter {
  const transport = options.transport ?? createDefaultTransport();
  const endpointUrl = buildEndpointUrl(options.baseUrl, options.endpoint ?? "/chat/completions");

  return {
    async generateStructured<TInput, TOutput>(request: StructuredLlmRequest<TInput, TOutput>): Promise<TOutput> {
      const messages = buildPromptMessages(request);
      const response = await transport({
        url: endpointUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
          ...options.headers,
        },
        body: JSON.stringify({
          model: options.model,
          temperature: options.temperature ?? 0,
          response_format: {
            type: "json_object",
          },
          messages,
        }),
      });

      const rawText = await response.text();
      if (!response.ok) {
        let message = `Structured LLM request failed with status ${response.status}.`;

        try {
          const parsed = JSON.parse(rawText) as OpenAiCompatibleChatCompletionResponse;
          if (parsed.error?.message) {
            message = `${message} ${parsed.error.message}`;
          }
        } catch {
          if (rawText.trim()) {
            message = `${message} ${rawText.trim()}`;
          }
        }

        throw new StructuredLlmError(message);
      }

      let parsedResponse: OpenAiCompatibleChatCompletionResponse;
      try {
        parsedResponse = JSON.parse(rawText) as OpenAiCompatibleChatCompletionResponse;
      } catch (error) {
        throw new StructuredLlmError(
          `Structured LLM transport returned non-JSON output: ${error instanceof Error ? error.message : "Unknown parse error."}`,
        );
      }

      const content = readMessageContent(parsedResponse.choices?.[0]?.message?.content);
      const structuredOutput = parseStructuredJson(content);
      return parsePromptOutput(request.prompt, structuredOutput);
    },
  };
}

export function createPromptBackedNodes(adapter: StructuredLlmAdapter): Pick<
  AgentWorkflowNodes,
  "discoveryParse" | "retrieveProcedure" | "draftOptOut" | "interpretResult"
> {
  return {
    discoveryParse: withPromptTrace(async function discoveryParse(input: ListingPromptInput): Promise<DiscoveryResult> {
      return adapter.generateStructured({
        prompt: listingClassifierPrompt,
        input,
      });
    }, listingClassifierPrompt),

    retrieveProcedure: withPromptTrace(async function retrieveProcedure(input: ProcedurePromptInput): Promise<RetrieveProcedureOutput> {
      return adapter.generateStructured({
        prompt: procedureSelectorPrompt,
        input,
      });
    }, procedureSelectorPrompt),

    draftOptOut: withPromptTrace(async function draftOptOut(input: DraftPromptInput, context: GraphContext): Promise<DraftOptOutOutput> {
      return adapter.generateStructured({
        prompt: draftGeneratorPrompt,
        input: {
          ...input,
          minimize_pii: context.policy.minimize_pii,
        },
      });
    }, draftGeneratorPrompt),

    interpretResult: withPromptTrace(async function interpretResult(input: PostExecutionPromptInput, context: GraphContext): Promise<InterpretResultOutput> {
      return adapter.generateStructured({
        prompt: postExecutionVerifierPrompt,
        input: {
          ...input,
          retry_count: input.retry_count,
          max_submission_retries: context.policy.max_submission_retries,
          pending_confirmation_strategy: context.policy.pending_confirmation_strategy,
          captcha_failure_strategy: context.policy.captcha_failure_strategy,
          manual_requirement_strategy: context.policy.manual_requirement_strategy,
        },
      });
    }, postExecutionVerifierPrompt),
  };
}

function buildQuery(input: ValidateConsentInput) {
  return [input.seed_profile.full_name, input.seed_profile.location.city, input.seed_profile.location.state].join(" ");
}

export function createDefaultConsentNode() {
  return function validateConsent(input: ValidateConsentInput, _context: GraphContext): ValidateConsentOutput {
    return {
      seed_profile: input.seed_profile,
      normalized_query: buildQuery(input),
      approved_for_submission: input.seed_profile.consent,
    };
  };
}

export function createFixtureLlmAdapter(
  fixtures: Partial<Record<PromptName, unknown | ((input: unknown) => unknown | Promise<unknown>)>>,
): StructuredLlmAdapter {
  return {
    async generateStructured<TInput, TOutput>({ prompt, input }: StructuredLlmRequest<TInput, TOutput>): Promise<TOutput> {
      const fixture = fixtures[prompt.name];
      if (!fixture) {
        throw new Error(`No fixture configured for prompt ${prompt.name}.`);
      }

      const result = typeof fixture === "function" ? await fixture(input) : fixture;
      return parsePromptOutput(prompt, result);
    },
  };
}
