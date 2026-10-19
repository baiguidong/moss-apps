---
name: ragflow
description: Search and manage a self-hosted RAGFlow enterprise knowledge base over MCP using either Moss identity or a RAGFlow API key. Use for knowledge retrieval, datasets, documents, chunks, parsing, uploads, chats, or RAGFlow agents.
---

# RAGFlow enterprise knowledge base

Use the `ragflow_*` MCP tools exposed by this connector. Start unfamiliar tasks with `ragflow_capabilities` so the enabled scopes and upload limits are known.

## Retrieval

1. Use `ragflow_list_datasets` when the target knowledge base ID is not already known.
2. Use `ragflow_retrieval` with the user's question and the narrowest relevant `dataset_ids` or `document_ids`.
3. Base the answer on returned chunks. Preserve document names, chunk IDs, and other source metadata as citations; do not claim knowledge that was not returned.
4. If multiple similarly named knowledge bases could change the answer, ask the user which one to use.

## Documents and parsing

- Use `ragflow_list_documents` and `ragflow_get_document` to inspect parsing state before retrying or changing anything.
- Use `ragflow_start_parsing` or `ragflow_stop_parsing` only when requested or when uploading with `auto_parse` enabled.
- Poll document state at a reasonable interval for parse-completion requests. Report failures with the server message.

## File uploads

For tiny text files, `ragflow_upload_document_base64` is available. Avoid placing large Base64 values in the conversation or tool context.

For normal and large local files:

1. Call `ragflow_create_upload_ticket` with the target dataset, filename, and `auto_parse` choice.
2. POST the file to the returned one-time `upload_url` as multipart field `file`. The connector injects either `MOSS_SERVER_AUTH_TOKEN` or `RAGFLOW_API_KEY`, depending on the selected authentication method. Use the available value without printing it:

```bash
if [[ -n "${MOSS_SERVER_AUTH_TOKEN:-}" ]]; then
  rag_auth_token="$MOSS_SERVER_AUTH_TOKEN"
else
  rag_auth_token="$RAGFLOW_API_KEY"
fi
curl --fail-with-body --silent --show-error \
  --request POST "$upload_url" \
  --header "Authorization: Bearer $rag_auth_token" \
  --form "file=@${file_path}"
```

3. Never enable shell tracing or echo either authentication token. Upload tickets expire and can only be used once.
4. Inspect the returned document ID and parsing result; use document tools for follow-up status.

## Mutating operations

- Before deleting datasets, documents, chunks, chat sessions, or agent sessions, state the exact target and obtain user confirmation. Then pass `confirm: true`.
- Prefer narrow IDs over bulk actions.
- Admin operations are not available unless the deployed Extended MCP explicitly enables the `admin` scope.
- With Moss Server authentication, the available tools are restricted by the current user's effective Moss roles. Never try to bypass a missing tool.

## Chats and agents

Use the `ragflow_list_chats`, session, and `ragflow_chat` tools for configured chat assistants. Use the corresponding `ragflow_list_agents`, session, and `ragflow_run_agent` tools for RAGFlow Agent workflows. Do not confuse these with direct retrieval from datasets.
