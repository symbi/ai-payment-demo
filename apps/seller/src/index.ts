import 'dotenv/config';
import { createSellerApp } from './app.ts';

const port = Number(process.env.SELLER_PORT ?? 4032);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SELLER_PORT');
const app = createSellerApp({ payTo: process.env.SELLER_PAY_TO, facilitatorUrl: process.env.FACILITATOR_URL });
app.listen(port, '127.0.0.1', () => console.log(`Seller listening at http://127.0.0.1:${port}`));
