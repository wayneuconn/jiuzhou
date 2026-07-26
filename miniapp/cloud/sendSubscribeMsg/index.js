const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// Template IDs — fill after creating templates in WeChat MP backend
const TEMPLATES = {
  promoted: 'Pd7bU1yJztmPwhicK6vI5nU0vqeRvXRw3aOl3IBTNdg',
  matchCancelled: 'YzYbL382sXtwfSgiireQodg3dQwfCuUAe2eAu2xVJ9I',
  // 会员申请审批提醒 — pick an approval-style template at mp.weixin.qq.com and
  // paste its ID here; until then these sends are silently skipped.
  membershipApplied: 'REPLACE_WITH_TEMPLATE_ID',
}

exports.main = async (event, context) => {
  // Internal-only: reject direct client invocations. When called from another
  // cloud function, the WXContext SOURCE chain ends with 'scf' rather than
  // 'wx_client'/'wx_devtools'.
  const source = String(cloud.getWXContext().SOURCE || '').split(',').pop()
  if (source === 'wx_client' || source === 'wx_devtools' || source === 'wx_unknown') {
    throw new Error('internal calls only')
  }

  const { type, toOpenid, data } = event
  if (!toOpenid || !data || !data.templateData) throw new Error('toOpenid and data.templateData required')

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
