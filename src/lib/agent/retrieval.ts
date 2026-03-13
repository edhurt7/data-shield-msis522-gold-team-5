import { z } from "zod";

import {
  discoveryResultSchema,
  procedureSourceChunkSchema,
  reviewReasonSchema,
  seedProfileSchema,
  type ReviewReason,
} from "@/lib/agent/contracts";
import type { GraphContext } from "@/lib/agent/graph";
import { builtInProcedureBackendResponses } from "@/lib/agent/procedure-backend-fixtures";
import {
  builtInProcedureDocuments,
  procedureDocumentSchema,
  type ProcedureDocument,
} from "@/lib/agent/procedure-documents";

export const procedureResolutionStatusSchema = z.enum(["found", "missing", "stale", "contradictory"]);

export const procedureRetrievalRequestSchema = z.object({
  seed_profile: seedProfileSchema,
  discovery_result: discoveryResultSchema,
  site: z.string().min(1),
  provided_chunks: z.array(procedureSourceChunkSchema).default([]),
  registry_chunks: z.array(procedureSourceChunkSchema).default([]),
});

export const procedureRetrievalResolutionSchema = z.object({
  status: procedureResolutionStatusSchema,
  chunks: z.array(procedureSourceChunkSchema).default([]),
  notes: z.string().nullable().default(null),
  review_reasons: z.array(reviewReasonSchema).default([]),
});

export const backendProcedureRecordSchema = z.object({
  procedure_id: z.string().min(1),
  site: z.string().min(1),
  updated_at: z.string().datetime(),
  channel_hint: z.enum(["email", "webform", "unknown"]),
  source_chunks: z.array(procedureSourceChunkSchema).min(1),
});

export const backendProcedureRetrievalResponseSchema = z.object({
  site: z.string().min(1),
  retrieved_at: z.string().datetime(),
  procedures: z.array(backendProcedureRecordSchema).default([]),
});

export const procedureRetrieverOptionsSchema = z.object({
  documents: z.array(procedureDocumentSchema).default([]),
  maxAgeDays: z.number().int().positive().default(60),
  now: z.string().datetime().optional(),
});

export type ProcedureResolutionStatus = z.infer<typeof procedureResolutionStatusSchema>;
export type ProcedureRetrievalRequest = z.infer<typeof procedureRetrievalRequestSchema>;
export type ProcedureRetrievalResolution = z.infer<typeof procedureRetrievalResolutionSchema>;
export type ProcedureRetrieverOptions = z.infer<typeof procedureRetrieverOptionsSchema>;
export type BackendProcedureRecord = z.infer<typeof backendProcedureRecordSchema>;
export type BackendProcedureRetrievalResponse = z.infer<typeof backendProcedureRetrievalResponseSchema>;

export type ProcedureRetriever = (
  input: ProcedureRetrievalRequest,
  context: GraphContext,
) => ProcedureRetrievalResolution | Promise<ProcedureRetrievalResolution>;

export interface ProcedureRetrievalBackendClient {
  retrieveProcedures: (
    input: ProcedureRetrievalRequest,
    context: GraphContext,
  ) => unknown | Promise<unknown>;
}

export interface BackendProcedureRetrieverOptions {
  client: ProcedureRetrievalBackendClient;
  maxAgeDays?: number;
  now?: string;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toTimestamp(value: string) {
  return new Date(value).getTime();
}

function sortByUpdatedAtDescending(documents: ProcedureDocument[]) {
  return [...documents].sort((left, right) => toTimestamp(right.updated_at) - toTimestamp(left.updated_at));
}

function flattenChunks(documents: ProcedureDocument[]) {
  return documents.flatMap((document) => document.chunks);
}

function sortBackendProceduresByUpdatedAtDescending(procedures: BackendProcedureRecord[]) {
  return [...procedures].sort((left, right) => toTimestamp(right.updated_at) - toTimestamp(left.updated_at));
}

function flattenBackendChunks(procedures: BackendProcedureRecord[]) {
  return procedures.flatMap((procedure) => procedure.source_chunks);
}

function ageInDays(updatedAt: string, now: string) {
  const diffMs = toTimestamp(now) - toTimestamp(updatedAt);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function hasContradictoryChannels(documents: ProcedureDocument[]) {
  const channels = unique(documents.map((document) => document.channel_hint).filter((value) => value !== "unknown"));
  return channels.length > 1;
}

function hasContradictoryBackendChannels(procedures: BackendProcedureRecord[]) {
  const channels = unique(procedures.map((procedure) => procedure.channel_hint).filter((value) => value !== "unknown"));
  return channels.length > 1;
}

export function reviewReasonsForProcedureResolution(status: ProcedureResolutionStatus): ReviewReason[] {
  switch (status) {
    case "missing":
      return ["missing_procedure"];
    case "stale":
      return ["stale_procedure"];
    case "contradictory":
      return ["contradictory_procedure"];
    default:
      return [];
  }
}

export function createBackendProcedureRetriever(options: BackendProcedureRetrieverOptions): ProcedureRetriever {
  const maxAgeDays = options.maxAgeDays ?? 60;

  return async function retrieveProcedureChunks(input, context) {
    if (input.provided_chunks.length > 0) {
      return {
        status: "found",
        chunks: input.provided_chunks,
        notes: "Using provided retrieval chunks.",
        review_reasons: [],
      };
    }

    if (input.registry_chunks.length > 0) {
      return {
        status: "found",
        chunks: input.registry_chunks,
        notes: "Using registry fallback retrieval chunks.",
        review_reasons: [],
      };
    }

    const rawResponse = await options.client.retrieveProcedures(input, context);
    const response = backendProcedureRetrievalResponseSchema.parse(rawResponse);
    const procedures = sortBackendProceduresByUpdatedAtDescending(
      response.procedures.filter((procedure) => procedure.site.toLowerCase() === input.site.toLowerCase()),
    );

    if (procedures.length === 0) {
      return {
        status: "missing",
        chunks: [],
        notes: `No backend procedures were found for ${input.site}.`,
        review_reasons: reviewReasonsForProcedureResolution("missing"),
      };
    }

    if (hasContradictoryBackendChannels(procedures)) {
      return {
        status: "contradictory",
        chunks: flattenBackendChunks(procedures),
        notes: `Backend procedure results for ${input.site} disagree on the submission channel.`,
        review_reasons: reviewReasonsForProcedureResolution("contradictory"),
      };
    }

    const referenceNow = options.now ?? new Date().toISOString();
    const freshestProcedure = procedures[0];
    const procedureAgeDays = ageInDays(freshestProcedure.updated_at, referenceNow);

    if (procedureAgeDays > maxAgeDays) {
      return {
        status: "stale",
        chunks: freshestProcedure.source_chunks,
        notes: `Newest backend procedure for ${input.site} is ${procedureAgeDays} days old.`,
        review_reasons: reviewReasonsForProcedureResolution("stale"),
      };
    }

    return {
      status: "found",
      chunks: freshestProcedure.source_chunks,
      notes: `Using backend procedure ${freshestProcedure.procedure_id}.`,
      review_reasons: [],
    };
  };
}

export function createStaticProcedureRetrievalBackendClient(
  responses: BackendProcedureRetrievalResponse[],
): ProcedureRetrievalBackendClient {
  const responseBySite = new Map(
    responses.map((response) => [response.site.toLowerCase(), backendProcedureRetrievalResponseSchema.parse(response)]),
  );

  return {
    retrieveProcedures(input) {
      return responseBySite.get(input.site.toLowerCase()) ?? {
        site: input.site,
        retrieved_at: new Date().toISOString(),
        procedures: [],
      };
    },
  };
}

export function createDocumentProcedureRetriever(options: Partial<ProcedureRetrieverOptions> = {}): ProcedureRetriever {
  const resolvedOptions = procedureRetrieverOptionsSchema.parse({
    documents: builtInProcedureDocuments,
    ...options,
  });

  return function retrieveProcedureChunks(input) {
    if (input.provided_chunks.length > 0) {
      return {
        status: "found",
        chunks: input.provided_chunks,
        notes: "Using provided retrieval chunks.",
        review_reasons: [],
      };
    }

    if (input.registry_chunks.length > 0) {
      return {
        status: "found",
        chunks: input.registry_chunks,
        notes: "Using registry fallback retrieval chunks.",
        review_reasons: [],
      };
    }

    const documents = sortByUpdatedAtDescending(
      resolvedOptions.documents.filter((document) => document.site.toLowerCase() === input.site.toLowerCase()),
    );

    if (documents.length === 0) {
      return {
        status: "missing",
        chunks: [],
        notes: `No procedure documents were found for ${input.site}.`,
        review_reasons: reviewReasonsForProcedureResolution("missing"),
      };
    }

    if (hasContradictoryChannels(documents)) {
      return {
        status: "contradictory",
        chunks: flattenChunks(documents),
        notes: `Procedure documents for ${input.site} disagree on the submission channel.`,
        review_reasons: reviewReasonsForProcedureResolution("contradictory"),
      };
    }

    const referenceNow = resolvedOptions.now ?? new Date().toISOString();
    const freshestDocument = documents[0];
    const documentAgeDays = ageInDays(freshestDocument.updated_at, referenceNow);

    if (documentAgeDays > resolvedOptions.maxAgeDays) {
      return {
        status: "stale",
        chunks: freshestDocument.chunks,
        notes: `Newest procedure document for ${input.site} is ${documentAgeDays} days old.`,
        review_reasons: reviewReasonsForProcedureResolution("stale"),
      };
    }

    return {
      status: "found",
      chunks: freshestDocument.chunks,
      notes: `Using procedure document ${freshestDocument.id}.`,
      review_reasons: [],
    };
  };
}

export function createDefaultProcedureRetriever(): ProcedureRetriever {
  return createBackendProcedureRetriever({
    client: createStaticProcedureRetrievalBackendClient(builtInProcedureBackendResponses),
  });
}
