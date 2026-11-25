export type AiRequestType = 'chat-completions' | 'responses'
export const aiInputTypes = ['image', 'pdf', 'video'] as const
export type AiInputType = (typeof aiInputTypes)[number]

export interface AiModelOptions {
  inputTypes?: AiInputType[]
  requestType: AiRequestType
  model: string
  reasoningEffort: string
  contextSize: number | null
  outputSize: number | null
}

export interface AiModelProfile extends AiModelOptions {
  id: string
  displayName?: string
  baseUrl: string
  hasKey: boolean
}

export interface AiConnectionDraft {
  id?: string
  baseUrl: string
  // A null key reuses the encrypted credential for this profile and endpoint.
  key: string | null
}

export type AiModelDraft = AiConnectionDraft & AiModelOptions & { displayName?: string }
