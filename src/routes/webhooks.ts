import { Hono } from 'hono'
import { getLogger } from '../logger/index.ts'
import type { ChannelManager } from '../channel/manager.ts'
import { WeComChannel } from '../channel/wecom.ts'

export function createWebhooksRoutes(channelManager: ChannelManager): Hono {
  const webhooks = new Hono()

  // WeCom URL verification (GET)
  webhooks.get('/webhooks/wecom/:channelId', async (c) => {
    const logger = getLogger()
    const channelId = c.req.param('channelId')

    const instance = channelManager.getChannelInstance(channelId)
    if (!instance || !(instance instanceof WeComChannel)) {
      logger.warn({ channelId }, 'Webhook: WeCom channel instance not found')
      return c.text('Channel not found', 404)
    }

    const { msg_signature, timestamp, nonce, echostr } = c.req.query()
    if (!msg_signature || !timestamp || !nonce || !echostr) {
      return c.text('Missing parameters', 400)
    }

    const result = instance.handleWebhookVerification({ msg_signature, timestamp, nonce, echostr })
    if (result.success) {
      return c.text(result.echostr!)
    }

    logger.warn({ channelId, error: result.error }, 'Webhook verification failed')
    return c.text('Verification failed', 403)
  })

  // WeCom message callback (POST)
  webhooks.post('/webhooks/wecom/:channelId', async (c) => {
    const logger = getLogger()
    const channelId = c.req.param('channelId')

    const instance = channelManager.getChannelInstance(channelId)
    if (!instance || !(instance instanceof WeComChannel)) {
      logger.warn({ channelId }, 'Webhook: WeCom channel instance not found')
      return c.text('Channel not found', 404)
    }

    const { msg_signature, timestamp, nonce } = c.req.query()
    if (!msg_signature || !timestamp || !nonce) {
      return c.text('Missing parameters', 400)
    }

    const body = await c.req.text()
    const result = instance.handleWebhookMessage({ msg_signature, timestamp, nonce }, body)

    if (result.success) {
      return c.text('success')
    }

    logger.warn({ channelId, error: result.error }, 'Webhook message processing failed')
    return c.text('Failed', 400)
  })

  return webhooks
}
