import { ShopifyOrder } from '../shopify/types.js';

export type SupportedLanguage = 'en' | 'es' | 'pt' | 'hi' | 'ar';

export interface TemplateSet {
  orderStatus: (order: ShopifyOrder) => string;
  orderNotFoundFirstTry: (orderNumber: string) => string;
  orderNotFoundFinalHandoff: (orderNumber: string) => string;
  unverifiedPhonePrompt: (orderNumber: string) => string;
  unverifiedEmailFailed: (orderNumber: string) => string;
  askForOrderNumber: () => string;
  recentOrdersFoundSingle: (order: ShopifyOrder) => string;
  recentOrdersFoundMultiple: (orders: ShopifyOrder[]) => string;
  humanHandoff: () => string;
  windowClosedPlaceholder: () => string;
  holdingInHandoff: () => string;
}

const TEMPLATES: Record<SupportedLanguage, TemplateSet> = {
  en: {
    orderStatus: (order) => {
      const tracking = order.trackingUrl
        ? order.trackingCompany
          ? `Tracking (${order.trackingCompany}): ${order.trackingUrl}`
          : `Tracking: ${order.trackingUrl}`
        : 'Tracking: No tracking link available yet.';
      return `Order #${order.orderNumber} Status: ${order.displayStatus}\nFulfillment: ${order.fulfillmentStatus}\n${tracking}`;
    },
    orderNotFoundFirstTry: (orderNumber) =>
      `We couldn't find order #${orderNumber}. Please check your order number and reply again (e.g. '#${orderNumber}').`,
    orderNotFoundFinalHandoff: (orderNumber) =>
      `We still couldn't locate order #${orderNumber} after two attempts. I have connected you with our human support team, and an agent will help you shortly.`,
    unverifiedPhonePrompt: (orderNumber) =>
      `For security, the phone number you are messaging from does not match the phone number on order #${orderNumber}. Please reply with your order number and the email address used when placing the order (e.g. '#${orderNumber} your-email@example.com').`,
    unverifiedEmailFailed: (orderNumber) =>
      `The email address provided does not match our records for order #${orderNumber}. For your protection, I've transferred this conversation to our support team.`,
    askForOrderNumber: () =>
      `I'd be happy to check your order status! Please reply with your order number (e.g. #1001).`,
    recentOrdersFoundSingle: (order) => {
      const tracking = order.trackingUrl
        ? `Tracking: ${order.trackingUrl}`
        : 'Tracking: No tracking link available yet.';
      return `We found your recent order #${order.orderNumber}!\nStatus: ${order.displayStatus}\nFulfillment: ${order.fulfillmentStatus}\n${tracking}`;
    },
    recentOrdersFoundMultiple: (orders) => {
      const list = orders.map((o) => `• #${o.orderNumber}: ${o.displayStatus}`).join('\n');
      return `We found ${orders.length} recent orders associated with your phone number:\n${list}\n\nPlease reply with the order number you would like tracking details for.`;
    },
    humanHandoff: () =>
      `I have transferred your request to our human support team. A representative will get back to you shortly.`,
    windowClosedPlaceholder: () =>
      `[Customer Support Update] Your order inquiry has been received. Our team is reviewing your message and will follow up shortly.`,
    holdingInHandoff: () =>
      `Your conversation is currently with our support desk. A human agent will respond to you shortly.`,
  },

  es: {
    orderStatus: (order) => {
      const tracking = order.trackingUrl
        ? order.trackingCompany
          ? `Seguimiento (${order.trackingCompany}): ${order.trackingUrl}`
          : `Seguimiento: ${order.trackingUrl}`
        : 'Seguimiento: Enlace de seguimiento aún no disponible.';
      return `Pedido #${order.orderNumber} Estado: ${order.displayStatus}\nCumplimiento: ${order.fulfillmentStatus}\n${tracking}`;
    },
    orderNotFoundFirstTry: (orderNumber) =>
      `No pudimos encontrar el pedido #${orderNumber}. Por favor verifica el número de pedido e intenta responder de nuevo (ej. '#${orderNumber}').`,
    orderNotFoundFinalHandoff: (orderNumber) =>
      `Aún no pudimos encontrar el pedido #${orderNumber}. He transferido tu solicitud a nuestro equipo de soporte humano para que te asista.`,
    unverifiedPhonePrompt: (orderNumber) =>
      `Por seguridad, el número de teléfono desde el que escribes no coincide con el registrado en el pedido #${orderNumber}. Por favor responde con tu número de pedido y el correo electrónico utilizado (ej. '#${orderNumber} tu-correo@ejemplo.com').`,
    unverifiedEmailFailed: (orderNumber) =>
      `El correo electrónico proporcionado no coincide con los registros del pedido #${orderNumber}. Por tu seguridad, he transferido esta conversación a nuestro equipo de soporte.`,
    askForOrderNumber: () =>
      `¡Con gusto consulto el estado de tu pedido! Por favor responde con tu número de pedido (ej. #1001).`,
    recentOrdersFoundSingle: (order) => {
      const tracking = order.trackingUrl
        ? `Seguimiento: ${order.trackingUrl}`
        : 'Seguimiento: Enlace aún no disponible.';
      return `¡Encontramos tu pedido reciente #${order.orderNumber}!\nEstado: ${order.displayStatus}\nCumplimiento: ${order.fulfillmentStatus}\n${tracking}`;
    },
    recentOrdersFoundMultiple: (orders) => {
      const list = orders.map((o) => `• #${o.orderNumber}: ${o.displayStatus}`).join('\n');
      return `Encontramos ${orders.length} pedidos recientes asociados a tu teléfono:\n${list}\n\nPor favor responde con el número de pedido que deseas consultar.`;
    },
    humanHandoff: () =>
      `He transferido tu solicitud a nuestro equipo de soporte humano. Un representante se comunicará contigo a la brevedad.`,
    windowClosedPlaceholder: () =>
      `[Actualización de Soporte] Hemos recibido tu consulta sobre el pedido. Nuestro equipo te responderá en breve.`,
    holdingInHandoff: () =>
      `Tu conversación se encuentra actualmente con nuestro equipo de soporte. Un agente te responderá pronto.`,
  },

  pt: {
    orderStatus: (order) => {
      const tracking = order.trackingUrl
        ? order.trackingCompany
          ? `Rastreamento (${order.trackingCompany}): ${order.trackingUrl}`
          : `Rastreamento: ${order.trackingUrl}`
        : 'Rastreamento: Link de rastreamento ainda não disponível.';
      return `Pedido #${order.orderNumber} Status: ${order.displayStatus}\nAtendimento: ${order.fulfillmentStatus}\n${tracking}`;
    },
    orderNotFoundFirstTry: (orderNumber) =>
      `Não encontramos o pedido #${orderNumber}. Por favor verifique o número do pedido e responda novamente (ex. '#${orderNumber}').`,
    orderNotFoundFinalHandoff: (orderNumber) =>
      `Ainda não localizamos o pedido #${orderNumber}. Encaminhei sua solicitação para a nossa equipe de suporte humano.`,
    unverifiedPhonePrompt: (orderNumber) =>
      `Por segurança, o telefone de onde você envia a mensagem não coincide com o registrado no pedido #${orderNumber}. Por favor responda com o número do pedido e o e-mail cadastrado (ex. '#${orderNumber} seu-email@exemplo.com').`,
    unverifiedEmailFailed: (orderNumber) =>
      `O e-mail informado não corresponde aos registros do pedido #${orderNumber}. Por segurança, transferi esta conversa para a nossa equipe de suporte.`,
    askForOrderNumber: () =>
      `Terei prazer em verificar o status do seu pedido! Por favor responda com o número do seu pedido (ex. #1001).`,
    recentOrdersFoundSingle: (order) => {
      const tracking = order.trackingUrl
        ? `Rastreamento: ${order.trackingUrl}`
        : 'Rastreamento: Link ainda não disponível.';
      return `Encontramos seu pedido recente #${order.orderNumber}!\nStatus: ${order.displayStatus}\nAtendimento: ${order.fulfillmentStatus}\n${tracking}`;
    },
    recentOrdersFoundMultiple: (orders) => {
      const list = orders.map((o) => `• #${o.orderNumber}: ${o.displayStatus}`).join('\n');
      return `Encontramos ${orders.length} pedidos recentes associados ao seu número:\n${list}\n\nPor favor responda com o número do pedido desejado.`;
    },
    humanHandoff: () =>
      `Transferi sua solicitação para a nossa equipe de suporte humano. Um atendente falará com você em breve.`,
    windowClosedPlaceholder: () =>
      `[Atualização de Suporte] Recebemos sua mensagem sobre o pedido. Nossa equipe entrará em contato em breve.`,
    holdingInHandoff: () =>
      `Sua conversa está com a nossa equipe de suporte. Um atendente responderá em breve.`,
  },

  hi: {
    orderStatus: (order) => {
      const tracking = order.trackingUrl
        ? order.trackingCompany
          ? `ट्रैकिंग (${order.trackingCompany}): ${order.trackingUrl}`
          : `ट्रैकिंग: ${order.trackingUrl}`
        : 'ट्रैकिंग: ट्रैकिंग लिंक अभी उपलब्ध नहीं है।';
      return `ऑर्डर #${order.orderNumber} स्थिति: ${order.displayStatus}\nपूर्ति स्थिति: ${order.fulfillmentStatus}\n${tracking}`;
    },
    orderNotFoundFirstTry: (orderNumber) =>
      `हमें ऑर्डर #${orderNumber} नहीं मिला। कृपया अपना ऑर्डर नंबर जांचें और दोबारा उत्तर दें (उदा. '#${orderNumber}')।`,
    orderNotFoundFinalHandoff: (orderNumber) =>
      `दो प्रयासों के बाद भी ऑर्डर #${orderNumber} नहीं मिल सका। मैंने आपकी बातचीत हमारे सपोर्ट एजेंट को सौंप दी है।`,
    unverifiedPhonePrompt: (orderNumber) =>
      `सुरक्षा कारणों से, आपका फ़ोन नंबर ऑर्डर #${orderNumber} के फ़ोन नंबर से मेल नहीं खाता है। कृपया अपना ऑर्डर नंबर और पंजीकृत ईमेल भेजें (उदा. '#${orderNumber} your-email@example.com')।`,
    unverifiedEmailFailed: (orderNumber) =>
      `दिया गया ईमेल ऑर्डर #${orderNumber} के रिकॉर्ड से मेल नहीं खाता है। सुरक्षा कारणों से मैंने यह बातचीत हमारी सहायता टीम को सौंप दी है।`,
    askForOrderNumber: () =>
      `मैं आपकी ऑर्डर स्थिति जांचने में प्रसन्न हूँ! कृपया अपना ऑर्डर नंबर भेजें (उदा. #1001)।`,
    recentOrdersFoundSingle: (order) => {
      const tracking = order.trackingUrl
        ? `ट्रैकिंग: ${order.trackingUrl}`
        : 'ट्रैकिंग: अभी उपलब्ध नहीं है।';
      return `हमें आपका हालिया ऑर्डर #${order.orderNumber} मिला!\nस्थिति: ${order.displayStatus}\nपूर्ति: ${order.fulfillmentStatus}\n${tracking}`;
    },
    recentOrdersFoundMultiple: (orders) => {
      const list = orders.map((o) => `• #${o.orderNumber}: ${o.displayStatus}`).join('\n');
      return `आपके फ़ोन नंबर से जुड़े ${orders.length} हालिया ऑर्डर मिले:\n${list}\n\nकृपया वह ऑर्डर नंबर बताएं जिसकी जानकारी आप चाहते हैं।`;
    },
    humanHandoff: () =>
      `मैंने आपका अनुरोध हमारे सपोर्ट एजेंट को सौंप दिया है। एक प्रतिनिधि जल्द ही आपसे संपर्क करेगा।`,
    windowClosedPlaceholder: () =>
      `[सपोर्ट अपडेट] आपका संदेश प्राप्त हो गया है। हमारी सहायता टीम जल्द ही आपसे संपर्क करेगी।`,
    holdingInHandoff: () =>
      `आपकी बातचीत वर्तमान में हमारी सहायता टीम के पास है। एक एजेंट जल्द ही जवाब देगा।`,
  },

  ar: {
    orderStatus: (order) => {
      const tracking = order.trackingUrl
        ? order.trackingCompany
          ? `التتبع (${order.trackingCompany}): ${order.trackingUrl}`
          : `التتبع: ${order.trackingUrl}`
        : 'التتبع: رابط التتبع غير متوفر بعد.';
      return `الطلب #${order.orderNumber} الحالة: ${order.displayStatus}\nحالة الشحن: ${order.fulfillmentStatus}\n${tracking}`;
    },
    orderNotFoundFirstTry: (orderNumber) =>
      `لم نتمكن من العثور على الطلب #${orderNumber}. يرجى التحقق من رقم الطلب والمحاولة مرة أخرى (مثال: '#${orderNumber}').`,
    orderNotFoundFinalHandoff: (orderNumber) =>
      `لم نتمكن من العثور على الطلب #${orderNumber} بعد محاولتين. قمت بتحويل طلبك إلى فريق الدعم البشري لمساعدتك.`,
    unverifiedPhonePrompt: (orderNumber) =>
      `لأسباب أمنية، رقم الهاتف الذي تراسلنا منه لا يتطابق مع المسجل في الطلب #${orderNumber}. يرجى تزويدنا برقم الطلب والبريد الإلكتروني المستخدم (مثال: '#${orderNumber} email@example.com').`,
    unverifiedEmailFailed: (orderNumber) =>
      `البريد الإلكتروني المقدم لا يتطابق مع سجلات الطلب #${orderNumber}. حفاظاً على أمانك، تم تحويل المحادثة إلى فريق الدعم.`,
    askForOrderNumber: () =>
      `يسعدني التحقق من حالة طلبك! يرجى الرد برقم الطلب (مثال: #1001).`,
    recentOrdersFoundSingle: (order) => {
      const tracking = order.trackingUrl
        ? `التتبع: ${order.trackingUrl}`
        : 'التتبع: غير متوفر بعد.';
      return `وجدنا طلبك الأخير #${order.orderNumber}!\nالحالة: ${order.displayStatus}\nالشحن: ${order.fulfillmentStatus}\n${tracking}`;
    },
    recentOrdersFoundMultiple: (orders) => {
      const list = orders.map((o) => `• #${o.orderNumber}: ${o.displayStatus}`).join('\n');
      return `وجدنا ${orders.length} طلبات حديثة مرتبطة برقم هاتفك:\n${list}\n\nيرجى تحديد رقم الطلب الذي ترغب في تفاصيله.`;
    },
    humanHandoff: () =>
      `تم تحويل طلبك إلى فريق الدعم البشري. سيتواصل معك أحد الممثلين قريباً.`,
    windowClosedPlaceholder: () =>
      `[تحديث الدعم] تم استلام استفسارك بخصوص الطلب. سيقوم فريقنا بالمتابعة معك قريباً.`,
    holdingInHandoff: () =>
      `محادثتك قيد المتابعة من قبل فريق الدعم. سيقوم أحد الوكلاء بالرد عليك قريباً.`,
  },
};

export function getTemplates(lang?: string): TemplateSet {
  const normalized = (lang || 'en').toLowerCase().slice(0, 2) as SupportedLanguage;
  return TEMPLATES[normalized] || TEMPLATES.en;
}
