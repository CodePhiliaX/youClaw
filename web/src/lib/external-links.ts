export const OFFICIAL_WEBSITE_URL = 'https://youclaw.dev'
export const OFFICIAL_DOCS_BASE_URL = `${OFFICIAL_WEBSITE_URL}/docs`

export function getOfficialDocsUrl(slug: string): string {
  const normalizedSlug = slug.replace(/^\/+/, '')
  return `${OFFICIAL_DOCS_BASE_URL}/${normalizedSlug}`
}
