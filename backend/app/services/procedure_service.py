from __future__ import annotations

from hashlib import sha256
from datetime import datetime, timezone
import math
import re
from uuid import uuid4

from sqlalchemy.orm import Session, selectinload

from app.models import ProcedureChunk, ProcedureChunkEmbedding, ProcedureDocument
from app.schemas.agent import (
    ProcedureIngestRequest,
    ProcedureIngestResponse,
    ProcedureRecordRead,
    ProcedureRetrievalRequest,
    ProcedureRetrievalResponse,
    ProcedureSearchRequest,
    ProcedureSearchResponse,
)


LOCAL_EMBEDDING_PROVIDER = "local_hash"
LOCAL_EMBEDDING_MODEL = "local-hash-128"
LOCAL_EMBEDDING_DIMENSIONS = 128


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def tokenize(value: str) -> list[str]:
    return re.findall(r"[a-z0-9@._-]+", normalize_text(value))


def content_hash(value: str) -> str:
    return sha256(normalize_text(value).encode("utf-8")).hexdigest()


def unique_preserving_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            ordered.append(value)
    return ordered


def chunk_text(raw_text: str, chunk_size: int = 280, overlap: int = 40) -> list[str]:
    text = re.sub(r"\s+", " ", raw_text).strip()
    if not text:
        return []

    paragraphs = [part.strip() for part in re.split(r"(?:\n\s*){2,}", raw_text) if part.strip()]
    if len(paragraphs) > 1:
        chunks = [re.sub(r"\s+", " ", paragraph).strip() for paragraph in paragraphs if paragraph.strip()]
        if chunks:
            return chunks

    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        proposed = f"{current} {sentence}".strip()
        if current and len(proposed) > chunk_size:
            chunks.append(current)
            if overlap > 0:
                current = f"{current[-overlap:]} {sentence}".strip()
            else:
                current = sentence
        else:
            current = proposed
    if current:
        chunks.append(current)

    return unique_preserving_order(chunks)


def build_query_terms(payload: ProcedureRetrievalRequest | ProcedureSearchRequest) -> list[str]:
    if isinstance(payload, ProcedureSearchRequest):
        return unique_preserving_order(tokenize(payload.query) + tokenize(payload.site))

    terms = tokenize(payload.site)
    discovery = payload.discovery_result
    seed_profile = payload.seed_profile

    if isinstance(seed_profile, dict):
        full_name = str(seed_profile.get("full_name", ""))
        privacy_email = str(seed_profile.get("privacy_email", ""))
        location = seed_profile.get("location", {}) if isinstance(seed_profile.get("location"), dict) else {}
        terms.extend(tokenize(full_name))
        terms.extend(tokenize(privacy_email))
        terms.extend(tokenize(str(location.get("city", ""))))
        terms.extend(tokenize(str(location.get("state", ""))))

    if isinstance(discovery, dict):
        for candidate in discovery.get("candidates", [])[:3]:
            if not isinstance(candidate, dict):
                continue
            terms.extend(tokenize(str(candidate.get("url", ""))))
            extracted = candidate.get("extracted", {})
            if isinstance(extracted, dict):
                for key in ("name", "age"):
                    terms.extend(tokenize(str(extracted.get(key, ""))))
                for collection_key in ("addresses", "relatives", "phones"):
                    collection = extracted.get(collection_key, [])
                    if isinstance(collection, list):
                        for item in collection:
                            terms.extend(tokenize(str(item)))

    terms.extend(
        [
            "opt",
            "out",
            "removal",
            "privacy",
            "delete",
            "suppression",
            "request",
            "webform",
            "email",
        ]
    )

    return unique_preserving_order(terms)


def chunk_relevance(chunk_text_value: str, query_terms: list[str]) -> tuple[float, list[str]]:
    normalized_chunk = normalize_text(chunk_text_value)
    chunk_tokens = set(tokenize(normalized_chunk))
    matched = [term for term in query_terms if term in chunk_tokens or term in normalized_chunk]
    matched = unique_preserving_order(matched)
    if not matched:
        return 0.0, []

    density = len(matched) / max(len(query_terms), 1)
    channel_bonus = 0.12 if any(term in normalized_chunk for term in ("webform", "email", "opt-out", "removal")) else 0.0
    score = min(1.0, density + channel_bonus)
    return score, matched


def embed_text_locally(value: str, dimensions: int = LOCAL_EMBEDDING_DIMENSIONS) -> list[float]:
    vector = [0.0] * dimensions
    tokens = tokenize(value)
    if not tokens:
        return vector

    for token in tokens:
        token_hash = sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(token_hash[:4], "big") % dimensions
        sign = 1.0 if token_hash[4] % 2 == 0 else -1.0
        magnitude = 1.0 + (token_hash[5] / 255.0)
        vector[index] += sign * magnitude

    norm = math.sqrt(sum(component * component for component in vector))
    if norm == 0:
        return vector
    return [round(component / norm, 6) for component in vector]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def get_or_create_chunk_embedding(chunk: ProcedureChunk) -> ProcedureChunkEmbedding:
    current_hash = content_hash(chunk.quote)
    for embedding in chunk.embeddings:
        if embedding.provider == LOCAL_EMBEDDING_PROVIDER and embedding.content_hash == current_hash:
            return embedding

    embedding = ProcedureChunkEmbedding(
        provider=LOCAL_EMBEDDING_PROVIDER,
        model=LOCAL_EMBEDDING_MODEL,
        dimensions=LOCAL_EMBEDDING_DIMENSIONS,
        content_hash=current_hash,
        vector=embed_text_locally(chunk.quote),
        embedding_metadata={"strategy": "hashed-token"},
    )
    chunk.embeddings.append(embedding)
    return embedding


def freshness_days(updated_at: datetime) -> int:
    normalized = ensure_utc(updated_at)
    return max(0, int((utcnow() - normalized).total_seconds() // 86400))


def to_procedure_record(
    document: ProcedureDocument,
    *,
    query_terms: list[str] | None = None,
    query_vector: list[float] | None = None,
) -> ProcedureRecordRead:
    ranked_chunks = []
    for chunk in document.chunks:
        lexical_score, matched_terms = chunk_relevance(chunk.quote, query_terms or [])
        embedding = get_or_create_chunk_embedding(chunk)
        embedding_score = cosine_similarity(query_vector or [], embedding.vector) if query_vector else 0.0
        combined_score = max(lexical_score, 0.0) * 0.65 + max(embedding_score, 0.0) * 0.35
        ranked_chunks.append(
            {
                "doc_id": chunk.doc_id,
                "quote": chunk.quote,
                "relevance_score": round(combined_score, 4) if query_terms or query_vector else None,
                "matched_terms": matched_terms if query_terms else [],
                "embedding_score": round(embedding_score, 4) if query_vector else None,
                "_lexical_score": lexical_score,
                "_combined_score": combined_score,
            }
        )

    if query_terms or query_vector:
        ranked_chunks.sort(key=lambda item: item["_combined_score"], reverse=True)

    top_chunks = ranked_chunks[:5]
    document_score = max((item["_combined_score"] for item in ranked_chunks), default=0.0)
    document_lexical_score = max((item["_lexical_score"] for item in ranked_chunks), default=0.0)
    document_embedding_score = max((item["embedding_score"] or 0.0 for item in ranked_chunks), default=0.0)

    return ProcedureRecordRead(
        procedure_id=document.id,
        site=document.site,
        updated_at=document.updated_at,
        channel_hint=document.channel_hint,
        source_chunks=[
            {
                "doc_id": chunk["doc_id"],
                "quote": chunk["quote"],
                "relevance_score": chunk["relevance_score"],
                "matched_terms": chunk["matched_terms"],
                "embedding_score": chunk["embedding_score"],
            }
            for chunk in top_chunks
        ],
        score=round(document_score, 4) if query_terms or query_vector else None,
        lexical_score=round(document_lexical_score, 4) if query_terms else None,
        embedding_score=round(document_embedding_score, 4) if query_vector else None,
        freshness_days=freshness_days(document.updated_at),
        summary=document.source_uri or None,
    )


def list_procedure_documents(db: Session, site: str) -> list[ProcedureDocument]:
    documents = (
        db.query(ProcedureDocument)
        .options(selectinload(ProcedureDocument.chunks).selectinload(ProcedureChunk.embeddings))
        .filter(ProcedureDocument.site.ilike(site))
        .order_by(ProcedureDocument.updated_at.desc())
        .all()
    )
    return documents


def list_procedures_for_site(db: Session, site: str) -> ProcedureRetrievalResponse:
    documents = list_procedure_documents(db, site)

    procedures = [to_procedure_record(document) for document in documents]

    return ProcedureRetrievalResponse(
        site=site,
        retrieved_at=utcnow(),
        procedures=procedures,
    )


def ingest_procedure_document(db: Session, payload: ProcedureIngestRequest) -> ProcedureIngestResponse:
    procedure_id = payload.procedure_id or f"proc_{uuid4().hex}"
    existing = db.get(ProcedureDocument, procedure_id)
    if existing is not None:
        db.delete(existing)
        db.flush()

    document = ProcedureDocument(
        id=procedure_id,
        site=payload.site,
        channel_hint=payload.channel_hint,
        source_uri=payload.summary or payload.source_uri,
        version=payload.version,
        is_active=payload.is_active,
        updated_at=utcnow(),
        created_at=utcnow(),
    )

    chunks = chunk_text(payload.raw_text, payload.chunk_size, payload.overlap)
    for index, chunk in enumerate(chunks):
        procedure_chunk = ProcedureChunk(
            doc_id=f"{procedure_id}-chunk-{index + 1}",
            quote=chunk,
            chunk_order=index,
        )
        if payload.regenerate_embeddings:
            get_or_create_chunk_embedding(procedure_chunk)
        document.chunks.append(procedure_chunk)

    db.add(document)
    db.commit()

    return ProcedureIngestResponse(
        procedure_id=document.id,
        site=document.site,
        chunk_count=len(document.chunks),
        version=document.version,
        updated_at=document.updated_at,
        embedding_provider=LOCAL_EMBEDDING_PROVIDER,
        embedding_model=LOCAL_EMBEDDING_MODEL,
    )


def search_procedure_documents(db: Session, payload: ProcedureSearchRequest) -> ProcedureSearchResponse:
    documents = list_procedure_documents(db, payload.site)
    query_terms = build_query_terms(payload)
    query_vector = embed_text_locally(payload.query)
    ranked = [to_procedure_record(document, query_terms=query_terms, query_vector=query_vector) for document in documents]
    ranked.sort(
        key=lambda record: (
            record.score or 0.0,
            -(record.freshness_days or 0),
        ),
        reverse=True,
    )

    filtered = [record for record in ranked if (record.score or 0.0) > 0][: payload.limit]
    return ProcedureSearchResponse(
        site=payload.site,
        query=payload.query,
        retrieved_at=utcnow(),
        procedures=filtered,
    )


def retrieve_relevant_procedures(db: Session, payload: ProcedureRetrievalRequest) -> ProcedureRetrievalResponse:
    documents = list_procedure_documents(db, payload.site)
    query_terms = build_query_terms(payload)
    query_vector = embed_text_locally(" ".join(query_terms))
    ranked = [to_procedure_record(document, query_terms=query_terms, query_vector=query_vector) for document in documents]
    ranked.sort(
        key=lambda record: (
            record.score or 0.0,
            -(record.freshness_days or 0),
        ),
        reverse=True,
    )

    if payload.registry_chunks:
        ranked.insert(
            0,
            ProcedureRecordRead(
                procedure_id=f"{payload.site.lower()}-registry",
                site=payload.site,
                updated_at=utcnow(),
                channel_hint="unknown",
                source_chunks=list(payload.registry_chunks),
                score=1.0,
                freshness_days=0,
                summary="Registry fallback chunks",
            ),
        )

    return ProcedureRetrievalResponse(
        site=payload.site,
        retrieved_at=utcnow(),
        procedures=ranked[:5],
    )
