# SEO Product Mapper

## Project Overview
- **Project name**: `webapp`
- **Goal**: automate the mapping of catalog products (columns `Category old`, `Product name`) to a target SEO hierarchy while returning `Не найдено` whenever the model is uncertain.
- **Key features**:
  - Session-based workflow for uploading one SEO structure and multiple product files.
  - Hybrid TF-IDF + char n-gram matcher with multi-threshold gating to prevent incorrect matches.
  - Optional OpenAI-powered reranking for ambiguous items.
  - Detailed Vue 3 interface with progress tracking, filtering, and XLSX/ZIP exports.

## Tech Stack
- **Runtime**: Cloudflare Pages + Hono (TypeScript)
- **Frontend**: Vue 3 (CDN), Tailwind CSS, Font Awesome
- **Data processing**: `xlsx`, custom TF-IDF vectorizer, Snowball (Russian stemmer)
- **Exports**: `xlsx`, `JSZip`

## System Architecture
### Backend (Hono Worker)
- REST API under `/api/*` exposed by `src/index.tsx`.
- `SeoMapper` (in `src/lib/seo-mapper.ts`) parses XLSX files, builds token statistics, and performs matching.
- `session/store.ts` keeps in-memory session state (1 hour TTL) to manage multiple uploads per user.
- Optional OpenAI fallback uses `text-embedding-3-small` embeddings fetched via HTTPS when `useOpenAI` is enabled.

### Frontend (public/index.html)
- Single-page Vue 3 app mirrors the Streamlit UX: upload cards, adjustable thresholds, progress bars, results table, and download actions.
- State persists within a session via the backend’s REST API.

### Data Flow
1. Client creates a session (`POST /api/session`).
2. Upload SEO structure → categories parsed and cached in the session.
3. Upload product workbooks → parsed into normalized records (tokens + aggregated text).
4. `/api/session/:id/run` triggers mapping for each uploaded dataset, storing results.
5. Users inspect or download per-file XLSX or a combined ZIP.

## Matching Algorithms & Evaluation
| # | Algorithm | Description | Expected quality | Latency / cost | Status |
|---|-----------|-------------|------------------|----------------|--------|
| 1 | **Hybrid TF-IDF + char n-grams** | Dense TF-IDF vectors built over word stems and char n-grams; weighted 60/40 with token-overlap heuristics and gap checks. | High on well-formed lexical matches; char n-grams remain competitive with dense embeddings on domain-specific tasks [1]. | Low (CPU, no network). | ✅ Implemented (default pipeline).
| 2 | **Hybrid + OpenAI embedding rerank** | Retains algorithm #1 to shortlist top candidates, then calls `text-embedding-3-small` to compare product text vs. candidate paths. Strict similarity + gap gating decides if the reranked best is accepted. | Very high for ambiguous cases; LLM-generated embeddings improve discrimination when lexical signals are weak [2]. | Medium (one OpenAI call per product batch; requires API key). | ✅ Implemented (toggle `useOpenAI`).
| 3 | **ruMTEB-optimised offline encoder** | Proposed enhancement: pre-compute category embeddings with retrieval-focused models such as BGE-M3 or ru-en-RoSBERTa, fine-tuned using InfoNCE and hard negatives per ruMTEB guidance. Use them for fast cosine reranking. | Expected highest recall on noisy cross-lingual catalogs due to superior semantic coverage [3]. | Medium/High one-time training, low inference with cached vectors. | 🔄 Planned.

The gating logic applies similarity, score-gap, token-overlap, and minimum-confidence checks. Any failure routes the product to `status = "not_mapped"` with `seoCategory = null`, ensuring outcomes like “Пневматические тормоза” incorrectly entering “Системы безопасности” are now blocked.

## Usage Guide
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Build the worker bundle**
   ```bash
   npm run build
   ```
3. **Local preview (Cloudflare Pages dev server)**
   ```bash
   npx wrangler pages dev dist --ip 0.0.0.0 --port 3000
   ```
4. Open the provided URL → upload the SEO structure and product workbooks → adjust thresholds → hit “Запустить обработку”.
5. Download individual XLSX files or the combined ZIP when processing finishes.

> **Sandbox tip**: follow the standard PM2 workflow (`pm2 start ecosystem.config.cjs`) if you need a persistent dev server inside the sandbox.

## API Summary
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/session` | Create a new session. |
| DELETE | `/api/session/:id` | Drop a session. |
| DELETE | `/api/session/:id/reset` | Clear uploaded data but keep the session. |
| POST | `/api/session/:id/seo` | Upload SEO hierarchy XLSX. |
| POST | `/api/session/:id/products` | Upload a product workbook. |
| POST | `/api/session/:id/run` | Run mapping (accepts optional overrides + `useOpenAI`). |
| GET | `/api/session/:id/results` | Inspect processed datasets. |
| GET | `/api/session/:id/download/:productId` | Download a single XLSX result. |
| GET | `/api/session/:id/download` | Download all results as ZIP. |
| GET | `/api/health` | Health probe. |

## Data & Storage Notes
- SEO and product data live only in memory for the session TTL (no Cloudflare D1/KV yet).
- XLSX parsing uses the first sheet and expects the SEO hierarchy in column A split by `///`.
- Product workbooks should contain `Category`, `Product name`, and optional descriptive fields (used to build aggregates for embeddings).

## OpenAI Integration
- Enable the toggle in the UI and provide an API key (stored in browser `localStorage`, sent only when running the job).
- The backend batches the product text with top `OPENAI_TOP_K` category paths and calls the embeddings endpoint.
- OpenAI reranking is used **only** when the baseline would output `Не найдено`, so it cannot override high-confidence lexical matches.

## Remaining Work / Next Steps
- Cache OpenAI embeddings per category and/or per product batch to minimise API calls.
- Implement the planned ruMTEB-based offline encoder pipeline (#3) with on-device cosine search.
- Persist sessions to Cloudflare KV or D1 for durability and user resumes.
- Add structured logging for audit trails and error analysis.
- Expand automated tests for XLSX edge cases and API validation.

## References
1. *TF-IDF Character N-grams versus Word Embedding-based Models for Fine-grained Event Classification*, ACL Anthology, 2020. [Link](https://aclanthology.org/2020.aespen-1.6/)
2. Zhao et al., *When Text Embedding Meets Large Language Model: A Comprehensive Survey*, arXiv, 2024. [Link](https://arxiv.org/html/2412.09165v1)
3. Markovich et al., *The Russian-focused embedders’ exploration: ruMTEB benchmark and Russian embedding model design*, arXiv, 2024. [Link](https://arxiv.org/html/2408.12503v1)
