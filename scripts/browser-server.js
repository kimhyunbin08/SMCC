import { createApp } from '../src/server.js';
import { openDatabase } from '../src/database.js';

const db = openDatabase(':memory:');
const server = createApp({ db, registration: true, secure: false, origin: 'http://127.0.0.1:3190',
  operatorName: '가상 테스트 운영자', supportEmail: 'test@example.invalid', maintenance: false });
server.listen(3190, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => db.close());
  server.closeIdleConnections();
});
