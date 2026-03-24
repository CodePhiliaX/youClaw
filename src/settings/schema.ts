import { z } from 'zod/v4'

export const RegistrySourceSettingSchema = z.enum(['clawhub', 'tencent'])
export type RegistrySourceSetting = z.infer<typeof RegistrySourceSettingSchema>

export const CustomModelProviderSchema = z.enum([
  'anthropic',
  'openai',
  'gemini',
  'custom',
  'minimax',
  'minimax-cn',
])

export const CustomModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: CustomModelProviderSchema.default('anthropic'),
  apiKey: z.string(),
  baseUrl: z.string().default(''),
  modelId: z.string(),
})

export const RegistrySourceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiBaseUrl: z.string().default('https://clawhub.ai/api/v1'),
  downloadUrl: z.string().default('https://clawhub.ai/api/v1/download'),
  token: z.string().default(''),
})

export const TencentRegistryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  indexUrl: z.string().default('https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json'),
  searchUrl: z.string().default('https://lightmake.site/api/v1/search'),
  downloadUrl: z.string().default('https://lightmake.site/api/v1/download'),
})

export const DEFAULT_CLAWHUB_REGISTRY_SOURCE = RegistrySourceConfigSchema.parse({})
export const DEFAULT_TENCENT_REGISTRY_SOURCE = TencentRegistryConfigSchema.parse({})

export const SettingsSchema = z.object({
  activeModel: z.object({
    provider: z.enum(['builtin', 'custom', 'cloud']),
    id: z.string().optional(),
  }).default({ provider: 'builtin' }),
  customModels: z.array(CustomModelSchema).default([]),
  defaultRegistrySource: RegistrySourceSettingSchema.optional(),
  registrySources: z.object({
    clawhub: RegistrySourceConfigSchema.default(DEFAULT_CLAWHUB_REGISTRY_SOURCE),
    tencent: TencentRegistryConfigSchema.default(DEFAULT_TENCENT_REGISTRY_SOURCE),
  }).default({
    clawhub: DEFAULT_CLAWHUB_REGISTRY_SOURCE,
    tencent: DEFAULT_TENCENT_REGISTRY_SOURCE,
  }),
})

export type Settings = z.infer<typeof SettingsSchema>
export type CustomModel = z.infer<typeof CustomModelSchema>
