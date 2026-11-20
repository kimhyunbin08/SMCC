export function chatId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value) ? value : undefined;
}

export function servicePath(search = '') {
  const input = new URLSearchParams(search);
  const output = new URLSearchParams();
  if (['host', 'guest'].includes(input.get('perspective'))) output.set('perspective', input.get('perspective'));
  if (['home', 'coffees', 'cafes', 'profile', 'teams', 'inbox', 'account'].includes(input.get('tab'))) output.set('tab', input.get('tab') === 'teams' ? 'coffees' : input.get('tab'));
  if (chatId(input.get('chat'))) output.set('chat', input.get('chat'));
  return `/service${output.size ? `?${output}` : ''}`;
}

export function initialTab(search, role) {
  const tab = new URLSearchParams(search).get('tab');
  return ['profile', 'teams', 'inbox', 'account'].includes(tab) ? tab : role === 'host' ? 'teams' : 'profile';
}

export function localDateTime(value) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) throw new Error('유효한 시작·종료 날짜를 입력하세요.');
  return time.toISOString();
}
