import {
  agentApiPaths,
  appendExecutionResultRequestSchema,
  appendExecutionResultResponseSchema,
  createMonitoredTargetSetFromRunRequestSchema,
  createMonitoredTargetSetFromRunResponseSchema,
  createRunRequestSchema,
  createRunResponseSchema,
  getRunResponseSchema,
  getMonitoredTargetSetResponseSchema,
  listRunsResponseSchema,
  listMonitoredTargetSetsResponseSchema,
  retrieveProceduresRequestSchema,
  retrieveProceduresResponseSchema,
  sendChatCommandRequestSchema,
  sendChatCommandResponseSchema,
  submitApprovalRequestSchema,
  submitApprovalResponseSchema,
  triggerRescanRequestSchema,
  triggerRescanResponseSchema,
  type AppendExecutionResultRequest,
  type AppendExecutionResultResponse,
  type CreateMonitoredTargetSetFromRunRequest,
  type CreateMonitoredTargetSetFromRunResponse,
  type CreateRunRequest,
  type CreateRunResponse,
  type GetRunResponse,
  type GetMonitoredTargetSetResponse,
  type ListRunsResponse,
  type ListMonitoredTargetSetsResponse,
  type RetrieveProceduresRequest,
  type RetrieveProceduresResponse,
  type SendChatCommandRequest,
  type SendChatCommandResponse,
  type SubmitApprovalRequest,
  type SubmitApprovalResponse,
  type TriggerRescanRequest,
  type TriggerRescanResponse,
} from "@/lib/agent/api";

export interface AgentApiClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class AgentApiError extends Error {
  status: number;
  body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export function createAgentApiClient(options: AgentApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const fetchFn = options.fetchFn ?? fetch;

  async function request<TRequest, TResponse>(
    path: string,
    init: RequestInit,
    requestBody: TRequest | undefined,
    parser: { parse: (value: unknown) => TResponse },
  ) {
    const response = await fetchFn(`${baseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      ...init,
      body: requestBody ? JSON.stringify(requestBody) : init.body,
    });

    const payload = await parseJson(response);

    if (!response.ok) {
      throw new AgentApiError(`Agent API request failed with status ${response.status}.`, response.status, payload);
    }

    return parser.parse(payload);
  }

  return {
    async createRun(input: CreateRunRequest): Promise<CreateRunResponse> {
      const body = createRunRequestSchema.parse(input);
      return request(agentApiPaths.runs, { method: "POST" }, body, createRunResponseSchema);
    },

    async listRuns(): Promise<ListRunsResponse> {
      return request(agentApiPaths.runs, { method: "GET" }, undefined, listRunsResponseSchema);
    },

    async getRun(runId: string): Promise<GetRunResponse> {
      return request(agentApiPaths.run(runId), { method: "GET" }, undefined, getRunResponseSchema);
    },

    async retrieveProcedures(input: RetrieveProceduresRequest): Promise<RetrieveProceduresResponse> {
      const body = retrieveProceduresRequestSchema.parse(input);
      return request(agentApiPaths.retrieveProcedures, { method: "POST" }, body, retrieveProceduresResponseSchema);
    },

    async listMonitoredTargetSets(): Promise<ListMonitoredTargetSetsResponse> {
      return request(agentApiPaths.monitoredTargetSets, { method: "GET" }, undefined, listMonitoredTargetSetsResponseSchema);
    },

    async getMonitoredTargetSet(targetSetId: string): Promise<GetMonitoredTargetSetResponse> {
      return request(agentApiPaths.monitoredTargetSet(targetSetId), { method: "GET" }, undefined, getMonitoredTargetSetResponseSchema);
    },

    async createMonitoredTargetSetFromRun(
      runId: string,
      input: CreateMonitoredTargetSetFromRunRequest,
    ): Promise<CreateMonitoredTargetSetFromRunResponse> {
      const body = createMonitoredTargetSetFromRunRequestSchema.parse(input);
      return request(
        agentApiPaths.runMonitoredTargetSet(runId),
        { method: "POST" },
        body,
        createMonitoredTargetSetFromRunResponseSchema,
      );
    },

    async sendChatCommand(runId: string, input: SendChatCommandRequest): Promise<SendChatCommandResponse> {
      const body = sendChatCommandRequestSchema.parse(input);
      return request(agentApiPaths.runChat(runId), { method: "POST" }, body, sendChatCommandResponseSchema);
    },

    async submitApproval(runId: string, input: SubmitApprovalRequest): Promise<SubmitApprovalResponse> {
      const body = submitApprovalRequestSchema.parse(input);
      return request(agentApiPaths.runApproval(runId), { method: "POST" }, body, submitApprovalResponseSchema);
    },

    async triggerRescan(runId: string, input: TriggerRescanRequest): Promise<TriggerRescanResponse> {
      const body = triggerRescanRequestSchema.parse(input);
      return request(agentApiPaths.runRescan(runId), { method: "POST" }, body, triggerRescanResponseSchema);
    },

    async appendExecutionResult(
      runId: string,
      input: AppendExecutionResultRequest,
    ): Promise<AppendExecutionResultResponse> {
      const body = appendExecutionResultRequestSchema.parse(input);
      return request(
        agentApiPaths.runExecutionResults(runId),
        { method: "POST" },
        body,
        appendExecutionResultResponseSchema,
      );
    },
  };
}

export type AgentApiClient = ReturnType<typeof createAgentApiClient>;
