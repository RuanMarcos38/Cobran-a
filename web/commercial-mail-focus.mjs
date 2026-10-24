let pending;
export function focusCommercialMail(value={}){pending={folder:'sent',account_id:value.account_id,email:value.email||'',provider_id:value.provider_id||''};}
export function takeCommercialMailFocus(){const result=pending;pending=undefined;return result;}
