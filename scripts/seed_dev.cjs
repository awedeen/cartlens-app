const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

const PRODUCTS = [
  { id: '7544712331323', title: 'The Complete Snowboard', variants: [
    { id: '43224527437883', title: 'Ice', price: 699.95, image: 'https://cdn.shopify.com/s/files/1/0661/3106/6939/files/Main_89a5c3e3-7cdb-4bca-8af4-c5f18a21cd85.jpg?v=1771458570' },
    { id: '43224527470651', title: 'Dawn', price: 699.95, image: null },
    { id: '43224527503419', title: 'Powder', price: 699.95, image: null },
    { id: '43224527536187', title: 'Electric', price: 699.95, image: null },
    { id: '43224527568955', title: 'Sunset', price: 699.95, image: null },
  ]},
  { id: '7544712659003', title: 'The Collection Snowboard: Liquid', variants: [
    { id: '43224527994939', title: null, price: 749.95, image: 'https://cdn.shopify.com/s/files/1/0661/3106/6939/files/Main_b13ad453-477c-4ed1-9b43-81f3345adfd6.jpg?v=1771458572' }
  ]},
  { id: '7544712527931', title: 'The Multi-location Snowboard', variants: [
    { id: '43224527831099', title: null, price: 729.95, image: 'https://cdn.shopify.com/s/files/1/0661/3106/6939/files/Main_0a4e9096-021a-4c1e-8750-24b233166a12.jpg?v=1771458570' }
  ]},
  { id: '7544712560699', title: 'The Collection Snowboard: Oxygen', variants: [
    { id: '43224527863867', title: null, price: 1025.00, image: 'https://cdn.shopify.com/s/files/1/0661/3106/6939/files/Main_89a5c3e3-7cdb-4bca-8af4-c5f18a21cd85.jpg?v=1771458570' }
  ]},
  { id: '7544712233019', title: 'The Videographer Snowboard', variants: [
    { id: '43224527175739', title: null, price: 885.95, image: 'https://cdn.shopify.com/s/files/1/0661/3106/6939/files/Main_c4d885ce-2c3f-4c91-9695-1e0d68bfa55b.jpg?v=1771458568' }
  ]},
  { id: '7544712298555', title: 'Selling Plans Ski Wax', variants: [
    { id: '43224527274043', title: 'Original Formula', price: 24.95, image: null },
    { id: '43224527306811', title: 'Premium Formula', price: 49.95, image: null },
    { id: '43224527339579', title: 'Travel Size', price: 9.95, image: null },
  ]},
  { id: '7544712626235', title: 'The Multi-managed Snowboard', variants: [
    { id: '43224527896635', title: null, price: 629.95, image: 'https://cdn.shopify.com/s/files/1/0661/3106/6939/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d.jpg?v=1771458570' }
  ]},
  { id: '7544712265787', title: 'The Archived Snowboard', variants: [
    { id: '43224527667259', title: null, price: 629.95, image: 'https://cdn.shopify.com/s/files/1/0661/3106/6939/files/Main_c4d885ce-2c3f-4c91-9695-1e0d68bfa55b.jpg?v=1771458568' }
  ]},
];

const SCENARIOS = [
  { utmSource:'fb', utmMedium:'paid_social', utmCampaign:'spring-sale-retarget', utmContent:'carousel-v1', referrerUrl:'https://l.facebook.com/', count:15, checkoutRate:0.55, orderRate:0.45, deviceType:'mobile', browser:'Safari', cities:['Los Angeles','New York','Miami','Chicago','Houston'] },
  { utmSource:'ig', utmMedium:'paid_social', utmCampaign:'spring-sale-retarget', utmContent:'story-v1', referrerUrl:'https://www.instagram.com/', count:11, checkoutRate:0.65, orderRate:0.55, deviceType:'mobile', browser:'Safari', cities:['New York','Los Angeles','Boston'] },
  { utmSource:'google', utmMedium:'cpc', utmCampaign:'branded-search', utmContent:'exact-match', referrerUrl:'https://www.google.com/', count:18, checkoutRate:0.78, orderRate:0.65, deviceType:'desktop', browser:'Chrome', cities:['Chicago','Denver','Seattle','Austin'] },
  { utmSource:'google', utmMedium:'cpc', utmCampaign:'competitor-keywords', utmContent:'broad-match', referrerUrl:'https://www.google.com/', count:8, checkoutRate:0.5, orderRate:0.38, deviceType:'desktop', browser:'Chrome', cities:['Portland','Phoenix','Dallas'] },
  { utmSource:'klaviyo', utmMedium:'email', utmCampaign:'spring-newsletter-2026', count:9, checkoutRate:0.88, orderRate:0.78, deviceType:'mobile', browser:'Safari', cities:['Seattle','Denver','Austin'] },
  { utmSource:'tiktok', utmMedium:'paid_social', utmCampaign:'ugc-spring', count:7, checkoutRate:0.42, orderRate:0.28, deviceType:'mobile', browser:'Safari', cities:['Miami','Los Angeles','New York'] },
  { utmSource:'attentive', utmMedium:'sms', utmCampaign:'flash-sale-apr', count:5, checkoutRate:0.8, orderRate:0.8, deviceType:'mobile', browser:'Safari', cities:['Houston','Phoenix'] },
  { utmSource:null, referrerUrl:'https://www.google.com/', count:8, checkoutRate:0.35, orderRate:0.25, deviceType:'desktop', browser:'Chrome', cities:['San Francisco','Atlanta','Nashville'] },
  { utmSource:null, count:9, checkoutRate:0.22, orderRate:0.11, deviceType:'mobile', browser:'Safari', cities:['Portland','Salt Lake City','Boise'] },
];

const NAMES = ['Sarah J.','Mike T.','Emma R.','James W.','Lisa K.','Chris P.','Anna M.','David L.','Rachel S.','Tom B.','Jessica C.','Ryan M.','Ashley D.','Brian K.','Nicole F.','Tyler H.','Megan S.','Josh P.','Amanda W.','Kevin R.','Lauren G.','Matt D.','Stephanie L.','Brandon M.'];
const EMAILS = ['sarah@gmail.com','mike@yahoo.com','emma@hotmail.com','james@gmail.com','lisa@icloud.com','chris@gmail.com','anna@outlook.com','david@gmail.com','rachel@yahoo.com','tom@gmail.com','jessica@icloud.com','ryan@gmail.com','ashley@yahoo.com','brian@hotmail.com','nicole@gmail.com','tyler@icloud.com','megan@gmail.com','josh@yahoo.com','amanda@outlook.com','kevin@gmail.com','lauren@icloud.com','matt@gmail.com','stephanie@yahoo.com','brandon@hotmail.com'];

async function main() {
  const shop = await prisma.shop.findFirst({ where: { shopifyDomain: 'cartlensteststorev1.myshopify.com' } });
  let total = 0;

  for (const sc of SCENARIOS) {
    for (let i = 0; i < sc.count; i++) {
      const daysAgo = Math.floor(Math.random() * 28);
      const baseTime = new Date(Date.now() - daysAgo * 86400000 - Math.random() * 50000000);
      
      const numProducts = Math.random() > 0.6 ? (Math.random() > 0.5 ? 3 : 2) : 1;
      const shuffled = [...PRODUCTS].sort(() => Math.random() - 0.5).slice(0, numProducts);
      
      let cartTotal = 0;
      let itemCount = 0;
      const cartItems = shuffled.map(p => {
        const variant = p.variants[Math.floor(Math.random() * p.variants.length)];
        const qty = Math.random() > 0.8 ? 2 : 1;
        cartTotal += variant.price * qty;
        itemCount += qty;
        return { product: p, variant, qty };
      });

      const checkoutStarted = Math.random() < sc.checkoutRate;
      const orderPlaced = checkoutStarted && Math.random() < sc.orderRate;
      const nameIdx = total % NAMES.length;
      const city = sc.cities[Math.floor(Math.random() * sc.cities.length)];

      const session = await prisma.cartSession.create({ data: {
        shopId: shop.id,
        visitorId: 'seed_' + Math.random().toString(36).slice(2),
        utmSource: sc.utmSource || null, utmMedium: sc.utmMedium || null,
        utmCampaign: sc.utmCampaign || null, utmContent: sc.utmContent || null,
        referrerUrl: sc.referrerUrl || null,
        landingPage: sc.utmSource ? `https://cartlensteststorev1.myshopify.com/collections/all?utm_source=${sc.utmSource}&utm_medium=${sc.utmMedium||''}&utm_campaign=${sc.utmCampaign||''}` : null,
        city, countryCode: 'US', country: 'United States',
        deviceType: sc.deviceType, browser: sc.browser,
        customerName: (checkoutStarted || orderPlaced) ? NAMES[nameIdx] : null,
        customerEmail: orderPlaced ? EMAILS[nameIdx] : null,
        cartCreated: true, checkoutStarted, orderPlaced,
        cartTotal, itemCount,
        orderValue: orderPlaced ? cartTotal : null,
        orderId: orderPlaced ? `gid://shopify/Order/${5000 + total}` : null,
        orderNumber: orderPlaced ? String(1001 + total) : null,
        createdAt: baseTime,
        updatedAt: new Date(baseTime.getTime() + (orderPlaced ? 600000 : checkoutStarted ? 300000 : 90000)),
      }});

      for (const item of cartItems) {
        await prisma.cartEvent.create({ data: {
          sessionId: session.id, eventType: 'cart_add',
          productId: item.product.id, productTitle: item.product.title,
          variantId: item.variant.id, variantTitle: item.variant.title,
          variantImage: item.variant.image,
          quantity: item.qty, price: item.variant.price,
          timestamp: new Date(baseTime.getTime() + 8000 + Math.random() * 30000),
        }});
      }
      
      if (cartItems.length > 1 && Math.random() > 0.7) {
        const removed = cartItems[0];
        await prisma.cartEvent.create({ data: {
          sessionId: session.id, eventType: 'cart_remove',
          productId: removed.product.id, productTitle: removed.product.title,
          variantId: removed.variant.id, variantTitle: removed.variant.title,
          quantity: removed.qty, price: removed.variant.price,
          timestamp: new Date(baseTime.getTime() + 60000),
        }});
      }

      if (checkoutStarted) await prisma.cartEvent.create({ data: { sessionId: session.id, eventType: 'checkout_started', timestamp: new Date(baseTime.getTime() + 120000) }});
      if (orderPlaced) await prisma.cartEvent.create({ data: { sessionId: session.id, eventType: 'checkout_completed', timestamp: new Date(baseTime.getTime() + 480000) }});
      total++;
    }
  }
  console.log('Seeded', total, 'sessions');
  await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
