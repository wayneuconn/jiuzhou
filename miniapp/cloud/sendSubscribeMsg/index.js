const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// Template IDs — fill after creating templates in WeChat MP backend
const TEMPLATES = {
  promoted: 'Pd7bU1yJztmPwhicK6vI5nU0vqeRvXRw3aOl3IBTNdg',
  matchCancelled: 'YzYbL382sXtwfSgiireQodg3dQwfCuUAe2eAu2xVJ9I',
}

exports.main = async (event, context) => {
  const { type, toOpenid, data } = event

  const templateId = TEMPLATES[type]
  if (!templateId) throw new Error(`unknown message type: ${type}`)
  // Skip silently if template hasn't been configured yet
  if (templateId.startsWith('REPLACE_')) return { skipped: true, reason: 'template not configured' }

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
