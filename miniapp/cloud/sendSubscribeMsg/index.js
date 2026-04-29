const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// Template IDs — fill after creating templates in WeChat MP backend
const TEMPLATES = {
  matchOpen: 'REPLACE_MATCH_OPEN_TEMPLATE_ID',
  promoted: 'REPLACE_PROMOTED_TEMPLATE_ID',
  draftReady: 'REPLACE_DRAFT_READY_TEMPLATE_ID',
}

exports.main = async (event, context) => {
  const { type, toOpenid, data } = event

  const templateId = TEMPLATES[type]
  if (!templateId) throw new Error(`unknown message type: ${type}`)

  await cloud.openapi.subscribeMessage.send({
    touser: toOpenid,
    templateId,
    page: data.page ?? '/pages/home/index',
    data: data.templateData,
    miniProgramState: 'formal',
    lang: 'zh_CN',
  })

  return { success: true }
}
