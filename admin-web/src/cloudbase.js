import cloudbase from '@cloudbase/js-sdk'

export const cloudbaseConfig = {
  env: import.meta.env.VITE_CLOUDBASE_ENV_ID || 'cloudbase-5gmfinom29f48930',
  region: import.meta.env.VITE_CLOUDBASE_REGION || 'ap-shanghai',
  accessKey:
    import.meta.env.VITE_CLOUDBASE_ACCESS_KEY ||
    'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkMWRjMzFlLWI0ZDAtNDQ4Yi1hNzZmLWIwY2M2M2Q4MTQ5OCJ9.eyJpc3MiOiJodHRwczovL2Nsb3VkYmFzZS01Z21maW5vbTI5ZjQ4OTMwLmFwLXNoYW5naGFpLnRjYi1hcGkudGVuY2VudGNsb3VkYXBpLmNvbSIsInN1YiI6ImFub24iLCJhdWQiOiJjbG91ZGJhc2UtNWdtZmlub20yOWY0ODkzMCIsImV4cCI6NDA4NDA0ODA5OSwiaWF0IjoxNzgwMzY0ODk5LCJub25jZSI6Ik5vbkNVVkd0U00tS1pwbnczU01GbmciLCJhdF9oYXNoIjoiTm9uQ1VWR3RTTS1LWnBudzNTTUZuZyIsIm5hbWUiOiJBbm9ueW1vdXMiLCJzY29wZSI6ImFub255bW91cyIsInByb2plY3RfaWQiOiJjbG91ZGJhc2UtNWdtZmlub20yOWY0ODkzMCIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJ1c2VyX3R5cGUiOiIiLCJjbGllbnRfdHlwZSI6ImNsaWVudF91c2VyIiwiaXNfc3lzdGVtX2FkbWluIjpmYWxzZX0.lM5WcH6d5J79Zzd6WmOaTluZKiBJKL56pfb3iIBvcwjSE4iZundwmpm8_OsihQswkJzu2cQPupZ4e9lHffz3u11O1jOez5Ys13ANSAsmtUzKeDJ05cKD03pIkATzC3Tu97oPxgNyl4WzDp7wPDb-Vn3szzPQ14qNBc3Y2Ef5CIYbtNqUJLcPOkWG31uVrwV-_X8rSjV1MkLSQLJRc-4s1cCdO4UgY2RAH5Guz621nGoSCq2iweKOq9t3tX0bk3srg-pFtOJTTj4iXkGKJ0UeEqvBicASklkz11UfgYdQQu4j1kYvMDoyCyrsCzoTqtRRgInIijwKrRDxlDPZujP6ZA'
}

export const app = cloudbase.init({
  env: cloudbaseConfig.env,
  region: cloudbaseConfig.region,
  accessKey: cloudbaseConfig.accessKey,
  auth: { detectSessionInUrl: true }
})

export const auth = app.auth({ persistence: 'local' })

export async function callAdmin(action, payload = {}) {
  const res = await app.callFunction({
    name: 'adminApi',
    data: { action, payload }
  })
  const result = res && res.result ? res.result : res
  if (!result || !result.success) {
    const message = (result && (result.message || result.error)) || '后台接口调用失败'
    const err = new Error(message)
    err.result = result
    throw err
  }
  return result
}
