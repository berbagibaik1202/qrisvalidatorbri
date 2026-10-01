// Classify browser diagnostics without logging error text, page data or credentials.
export function browserFailure(error:unknown){
  const message=error instanceof Error?error.message:'';
  const type=error instanceof Error?error.name:'Unknown';
  const method=message.match(/Protocol error \(([A-Za-z]+\.[A-Za-z]+)\)/)?.[1]||null;
  const code=/^(BRI_[A-Z_]+|MERCHANT_IDENTITY_MISMATCH|SOURCE_IDENTITY_MISMATCH|BROWSER_NOT_FOUND)$/.test(message)?message:
    /target closed|session closed|connection closed|browser has disconnected/i.test(message)?'BRI_BROWSER_DISCONNECTED':
    /execution context was destroyed|cannot find context/i.test(message)?'BRI_PAGE_NAVIGATED':
    /timed out|timeout/i.test(message)?'BRI_BROWSER_TIMEOUT':type==='ProtocolError'?'BRI_BROWSER_PROTOCOL_ERROR':'BRI_OPERATION_FAILED';
  return {type,code,method};
}
