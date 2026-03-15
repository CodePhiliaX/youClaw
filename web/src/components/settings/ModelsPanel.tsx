import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { Plus, Pencil, Trash2, Check, Settings2, Cloud, Cpu } from "lucide-react"
import { getSettings, updateSettings as apiUpdateSettings, type SettingsDTO, type CustomModelDTO } from "@/api/client"
import { useAppStore } from "@/stores/app"

// 内置模型定义
const BUILTIN_MODELS = [
  {
    id: "youclaw-pro",
    name: "YouClaw Pro",
    description: "Most capable built-in model",
  },
] as const

interface ActiveModel {
  provider: "builtin" | "custom" | "cloud"
  id?: string
}

export function ModelsPanel() {
  const { t } = useI18n()
  const { cloudEnabled } = useAppStore()
  const [builtinModel, setBuiltinModel] = useState("youclaw-pro")
  const [customModels, setCustomModels] = useState<CustomModelDTO[]>([])
  const [activeModel, setActiveModel] = useState<ActiveModel>({ provider: "builtin" })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<CustomModelDTO | null>(null)
  // 表单字段
  const [formName, setFormName] = useState("")
  const [formModelId, setFormModelId] = useState("")
  const [formApiKey, setFormApiKey] = useState("")
  const [formBaseUrl, setFormBaseUrl] = useState("")
  // 表单校验错误（字段被 touch 后才展示）
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // 从后端 API 加载
  useEffect(() => {
    getSettings().then((settings) => {
      setActiveModel(settings.activeModel)
      setCustomModels(settings.customModels)
    }).catch(console.error)
  }, [])

  // 保存到后端，并同步 modelReady
  const saveSettings = useCallback(async (partial: Partial<SettingsDTO>) => {
    try {
      const updated = await apiUpdateSettings(partial)
      setActiveModel(updated.activeModel)
      setCustomModels(updated.customModels)

      // 同步 modelReady 到全局 store
      const { provider, id } = updated.activeModel
      if (provider === 'builtin' || provider === 'cloud') {
        useAppStore.setState({ modelReady: cloudEnabled })
      } else {
        const model = id
          ? updated.customModels.find((m) => m.id === id)
          : updated.customModels[0]
        useAppStore.setState({ modelReady: !!model })
      }
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }, [cloudEnabled])

  // 切换 active provider
  const handleSetActiveProvider = async (provider: "builtin" | "custom") => {
    let newActive: ActiveModel
    if (provider === "builtin") {
      newActive = { provider: "builtin" }
    } else {
      const defaultModel = customModels[0]
      if (!defaultModel) return
      newActive = { provider: "custom", id: defaultModel.id }
    }
    setActiveModel(newActive)
    await saveSettings({ activeModel: newActive })
  }

  // 选择内置模型
  const handleSelectBuiltin = async (id: string) => {
    setBuiltinModel(id)
  }

  // 设置自定义模型为激活
  const handleSetCustomActive = async (id: string) => {
    const newActive: ActiveModel = { provider: "custom", id }
    setActiveModel(newActive)
    await saveSettings({ activeModel: newActive })
  }

  // 表单校验
  const formErrors = {
    name: !formName.trim() ? t.settings.validationRequired ?? 'Required' : null,
    modelId: !formModelId.trim()
      ? t.settings.validationRequired ?? 'Required'
      : /\s/.test(formModelId.trim())
        ? t.settings.validationModelIdNoSpaces ?? 'Model ID cannot contain spaces'
        : null,
    apiKey: !editingModel && !formApiKey.trim()
      ? t.settings.validationRequired ?? 'Required'
      : formApiKey.trim() && formApiKey.trim().length < 8
        ? t.settings.validationApiKeyTooShort ?? 'API Key is too short'
        : null,
    baseUrl: formBaseUrl.trim() && !/^https?:\/\/.+/.test(formBaseUrl.trim())
      ? t.settings.validationBaseUrlFormat ?? 'Must start with http:// or https://'
      : null,
  }
  const hasErrors = Object.values(formErrors).some((e) => e !== null)

  const handleBlur = (field: string) => setTouched((prev) => ({ ...prev, [field]: true }))

  // 打开添加 dialog
  const handleOpenAdd = () => {
    setEditingModel(null)
    setFormName("")
    setFormModelId("")
    setFormApiKey("")
    setFormBaseUrl("")
    setTouched({})
    setDialogOpen(true)
  }

  // 打开编辑 dialog
  const handleOpenEdit = (model: CustomModelDTO) => {
    setEditingModel(model)
    setFormName(model.name)
    setFormModelId(model.modelId)
    setFormApiKey("")
    setFormBaseUrl(model.baseUrl)
    setTouched({})
    setDialogOpen(true)
  }

  // 保存自定义模型（新建或编辑）
  const handleSaveModel = async () => {
    // 标记所有字段为已触碰，显示全部错误
    setTouched({ name: true, modelId: true, apiKey: true, baseUrl: true })
    if (hasErrors) return

    let updated: CustomModelDTO[]
    if (editingModel) {
      updated = customModels.map((m) =>
        m.id === editingModel.id
          ? {
              ...m,
              name: formName,
              modelId: formModelId,
              baseUrl: formBaseUrl,
              provider: 'anthropic' as const,
              ...(formApiKey.trim() ? { apiKey: formApiKey } : {}),
            }
          : m
      )
    } else {
      const newModel: CustomModelDTO = {
        id: crypto.randomUUID(),
        name: formName,
        provider: 'anthropic',
        modelId: formModelId,
        apiKey: formApiKey,
        baseUrl: formBaseUrl,
      }
      updated = [...customModels, newModel]
    }
    setCustomModels(updated)
    await saveSettings({ customModels: updated })
    setDialogOpen(false)
  }

  // 删除自定义模型
  const handleDeleteModel = async (id: string) => {
    if (!confirm(t.settings.confirmDeleteModel)) return
    const updated = customModels.filter((m) => m.id !== id)
    setCustomModels(updated)

    const partial: Partial<SettingsDTO> = { customModels: updated }
    if (activeModel.provider === "custom" && activeModel.id === id) {
      const newActive: ActiveModel = { provider: "builtin" }
      setActiveModel(newActive)
      partial.activeModel = newActive
    }
    await saveSettings(partial)
  }

  // 判断当前模型是否激活
  const isCustomActive = (id: string) => activeModel.provider === "custom" && activeModel.id === id

  return (
    <div className="space-y-8">
      {/* Active Model 区 */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          {t.settings.activeModel}
        </h4>
        <div className={cn("grid gap-3", cloudEnabled ? "grid-cols-2" : "grid-cols-1")}>
          {/* 内置模型（云服务）卡片 — 离线模式隐藏 */}
          {cloudEnabled && (
            <button
              onClick={() => handleSetActiveProvider("builtin")}
              className={cn(
                "relative flex items-start gap-4 p-5 rounded-2xl border-2 text-left transition-all",
                activeModel.provider === "builtin" || activeModel.provider === "cloud"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              )}
            >
              <div className={cn(
                "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                activeModel.provider === "builtin" || activeModel.provider === "cloud"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}>
                <Cloud size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{t.settings.builtinProvider}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t.settings.cloudDesc}
                </div>
              </div>
              {(activeModel.provider === "builtin" || activeModel.provider === "cloud") && (
                <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
              )}
            </button>
          )}

          {/* 自定义 API 卡片 */}
          <button
            onClick={() => handleSetActiveProvider("custom")}
            className={cn(
              "relative flex items-start gap-4 p-5 rounded-2xl border-2 text-left transition-all",
              activeModel.provider === "custom"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/30",
              customModels.length === 0 && "opacity-50 cursor-not-allowed"
            )}
            disabled={customModels.length === 0}
          >
            <div className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              activeModel.provider === "custom"
                ? "bg-orange-500 text-white"
                : "bg-muted text-muted-foreground"
            )}>
              <Settings2 size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{t.settings.customProvider}</div>
              <div className="text-xs text-muted-foreground mt-1">{t.settings.customDesc}</div>
            </div>
            {activeModel.provider === "custom" && (
              <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
            )}
          </button>
        </div>
      </div>

      {/* 内置模型列表 — 离线模式隐藏 */}
      {cloudEnabled && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
            {t.settings.builtinModels}
          </h4>
          <div className="space-y-2">
            {BUILTIN_MODELS.map((model) => {
              const isActive = builtinModel === model.id && (activeModel.provider === "builtin" || activeModel.provider === "cloud")
              return (
                <button
                  key={model.id}
                  onClick={() => handleSelectBuiltin(model.id)}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition-all",
                    isActive
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}>
                      <Cpu size={18} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold flex items-center gap-2">
                        {model.name}
                        {isActive && (
                          <span className="text-xs font-medium text-primary flex items-center gap-1">
                            <Check size={12} />
                            {t.settings.currentSelection}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{model.description}</div>
                    </div>
                  </div>
                  {isActive && (
                    <div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 自定义模型列表 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            {t.settings.customModels}
          </h4>
          <Button variant="ghost" size="sm" onClick={handleOpenAdd} className="h-7 gap-1 rounded-lg">
            <Plus size={14} />
            {t.settings.addCustomModel}
          </Button>
        </div>
        {customModels.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center border-2 border-dashed rounded-2xl">
            {t.settings.customDesc}
          </div>
        ) : (
          <div className="space-y-2">
            {customModels.map((model) => (
              <div
                key={model.id}
                className={cn(
                  "flex items-center justify-between p-4 rounded-2xl border-2 transition-all",
                  isCustomActive(model.id) ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                )}
              >
                <div className="min-w-0 flex-1 flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                    isCustomActive(model.id)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}>
                    <Settings2 size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      {model.name}
                      {isCustomActive(model.id) && (
                        <span className="text-xs font-medium text-primary flex items-center gap-1">
                          <Check size={12} />
                          {t.settings.currentSelection}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{model.modelId}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!isCustomActive(model.id) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs rounded-lg"
                      onClick={() => handleSetCustomActive(model.id)}
                    >
                      {t.settings.setDefault}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-lg"
                    onClick={() => handleOpenEdit(model)}
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-lg text-destructive hover:text-destructive"
                    onClick={() => handleDeleteModel(model.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 添加/编辑 Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[90vw] max-w-2xl p-6">
          <h2 className="text-lg font-semibold mb-4">
            {editingModel ? t.settings.editModel : t.settings.addCustomModel}
          </h2>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t.settings.modelName}</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onBlur={() => handleBlur('name')}
                placeholder={t.settings.modelNamePlaceholder}
                className={cn("rounded-xl", touched.name && formErrors.name ? 'border-destructive' : '')}
              />
              {touched.name && formErrors.name && (
                <p className="text-xs text-destructive">{formErrors.name}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t.settings.modelId}</Label>
              <Input
                value={formModelId}
                onChange={(e) => setFormModelId(e.target.value)}
                onBlur={() => handleBlur('modelId')}
                placeholder={t.settings.modelIdPlaceholder}
                className={cn("rounded-xl", touched.modelId && formErrors.modelId ? 'border-destructive' : '')}
              />
              {touched.modelId && formErrors.modelId && (
                <p className="text-xs text-destructive">{formErrors.modelId}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                onBlur={() => handleBlur('apiKey')}
                placeholder={editingModel ? t.settings.apiKeyEditPlaceholder ?? "Leave empty to keep current key" : t.settings.apiKeyPlaceholder}
                className={cn("rounded-xl", touched.apiKey && formErrors.apiKey ? 'border-destructive' : '')}
              />
              {touched.apiKey && formErrors.apiKey && (
                <p className="text-xs text-destructive">{formErrors.apiKey}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Base URL</Label>
              <Input
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
                onBlur={() => handleBlur('baseUrl')}
                placeholder={t.settings.baseUrlPlaceholder}
                className={cn("rounded-xl", touched.baseUrl && formErrors.baseUrl ? 'border-destructive' : '')}
              />
              {touched.baseUrl && formErrors.baseUrl && (
                <p className="text-xs text-destructive">{formErrors.baseUrl}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">
                {t.common.cancel}
              </Button>
              <Button onClick={handleSaveModel} disabled={hasErrors} className="rounded-xl">
                {t.common.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
