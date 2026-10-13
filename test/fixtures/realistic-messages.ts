export interface CustomerMessageFixture {
  id: string;
  description: string;
  message: string;
  senderPhone: string;
  businessPhone: string;
  expectedLanguage: 'en' | 'es' | 'pt' | 'hi' | 'ar';
  expectedOutcome:
    | 'order_status_revealed'
    | 'email_verification_requested'
    | 'order_not_found_prompt'
    | 'order_not_found_handoff'
    | 'multiple_orders_listed'
    | 'ask_for_order_number'
    | 'human_handoff'
    | 'refund_handoff'
    | 'angry_customer_handoff'
    | 'unclear_handoff';
  expectedHandoffReason?: string;
  expectedResponseSnippet?: string;
}

export const REALISTIC_MESSAGE_FIXTURES: CustomerMessageFixture[] = [
  // 1-5: English order queries with clean / typos / messy formats
  {
    id: 'msg_01_clean_en',
    description: 'Clean English order query with hash',
    message: 'Where is my order #1001?',
    senderPhone: '+15559998888', // Matches Order #1001
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'Order #1001 Status: Delivered',
  },
  {
    id: 'msg_02_typo_ordr',
    description: 'Typo in "order" keyword',
    message: 'where is my ordr #1001 please',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'Order #1001 Status: Delivered',
  },
  {
    id: 'msg_03_space_hash',
    description: 'Space between hash and digits',
    message: 'Status of # 1001?',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'Order #1001 Status: Delivered',
  },
  {
    id: 'msg_04_no_hash',
    description: 'Order query without hash',
    message: 'Track order 1001',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'Order #1001 Status: Delivered',
  },
  {
    id: 'msg_05_messy_sentence',
    description: 'Messy sentence with colon',
    message: 'Hey there, I ordered yesterday, can u check order: 1001?',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'Order #1001 Status: Delivered',
  },

  // 6-10: Multi-language order queries (matching phone)
  {
    id: 'msg_06_spanish_clean',
    description: 'Spanish order query',
    message: '¿Dónde está mi pedido #1001?',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'es',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'Pedido #1001 Estado: Delivered',
  },
  {
    id: 'msg_07_spanish_typo',
    description: 'Spanish order query with typo',
    message: 'donde esta mi peddo #1001 porfa',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'es',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'Pedido #1001 Estado: Delivered',
  },
  {
    id: 'msg_08_portuguese_clean',
    description: 'Portuguese order query',
    message: 'Onde está o meu pedido #1001?',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'pt',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'Pedido #1001 Status: Delivered',
  },
  {
    id: 'msg_09_hindi_clean',
    description: 'Hindi order query',
    message: 'मेरा ऑर्डर #1001 कहाँ है?',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'hi',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'ऑर्डर #1001 स्थिति: Delivered',
  },
  {
    id: 'msg_10_arabic_clean',
    description: 'Arabic order query',
    message: 'أين طلبي رقم #1001؟',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'ar',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'الطلب #1001 الحالة: Delivered',
  },

  // 11-15: Phone mismatch in various languages (Identity check requests email fallback)
  {
    id: 'msg_11_mismatch_en',
    description: 'English phone mismatch for Order #1002 (belonging to Bob)',
    message: 'Check status of order #1002',
    senderPhone: '+15559998888', // Not Bob's phone (+15557776666)
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'email_verification_requested',
    expectedResponseSnippet: 'does not match the phone number on order #1002',
  },
  {
    id: 'msg_12_mismatch_es',
    description: 'Spanish phone mismatch for Order #1002',
    message: '¿Dónde está el pedido #1002?',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'es',
    expectedOutcome: 'email_verification_requested',
    expectedResponseSnippet: 'no coincide con el registrado en el pedido #1002',
  },
  {
    id: 'msg_13_mismatch_pt',
    description: 'Portuguese phone mismatch for Order #1002',
    message: 'Status do pedido #1002 por favor',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'pt',
    expectedOutcome: 'email_verification_requested',
    expectedResponseSnippet: 'não coincide com o registrado no pedido #1002',
  },
  {
    id: 'msg_14_mismatch_hi',
    description: 'Hindi phone mismatch for Order #1002',
    message: 'ऑर्डर #1002 का स्टेटस बताइए',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'hi',
    expectedOutcome: 'email_verification_requested',
    expectedResponseSnippet: 'ऑर्डर #1002 के फ़ोन नंबर से मेल नहीं खाता है',
  },
  {
    id: 'msg_15_mismatch_ar',
    description: 'Arabic phone mismatch for Order #1002',
    message: 'تتبع الطلب #1002',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'ar',
    expectedOutcome: 'email_verification_requested',
    expectedResponseSnippet: 'لا يتطابق مع المسجل في الطلب #1002',
  },

  // 16-17: Email verification attempts
  {
    id: 'msg_16_email_match',
    description: 'Email fallback match for Order #1002 (Bob)',
    message: 'My email is bob@example.com for order #1002',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'Order #1002 Status: In Transit',
  },
  {
    id: 'msg_17_email_mismatch',
    description: 'Email fallback mismatch for Order #1002',
    message: 'My email is fraudster@evil.com for order #1002',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'human_handoff',
    expectedHandoffReason: 'unverified',
    expectedResponseSnippet: 'does not match our records for order #1002',
  },

  // 18-19: Non-existent order numbers (first try prompt vs second try handoff)
  {
    id: 'msg_18_order_not_found_try1',
    description: 'First attempt for non-existent order #9999',
    message: 'Where is order #9999?',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'order_not_found_prompt',
    expectedResponseSnippet: "couldn't find order #9999",
  },
  {
    id: 'msg_19_order_not_found_try2',
    description: 'Second attempt for non-existent order #9999',
    message: 'I am checking #9999 again',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'order_not_found_handoff',
    expectedHandoffReason: 'order_not_found',
    expectedResponseSnippet: 'connected you with our human support team',
  },

  // 20-22: Phone lookup when no order number given
  {
    id: 'msg_20_phone_lookup_single',
    description: 'No order number, but sender phone has exactly 1 order (#1002)',
    message: 'Where is my package?',
    senderPhone: '+15557776666', // Bob's phone (only 1 order: #1002)
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'order_status_revealed',
    expectedResponseSnippet: 'found your recent order #1002',
  },
  {
    id: 'msg_21_phone_lookup_multiple',
    description: 'No order number, sender phone has multiple orders (#1001, #1003)',
    message: 'Can you track my orders?',
    senderPhone: '+15559998888', // Alice's phone (orders #1001 and #1003)
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'multiple_orders_listed',
    expectedResponseSnippet: 'found 2 recent orders associated with your phone',
  },
  {
    id: 'msg_22_phone_lookup_none',
    description: 'No order number, unknown phone number with no history',
    message: 'Where is my order?',
    senderPhone: '+15550009999', // Unknown phone
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'ask_for_order_number',
    expectedResponseSnippet: 'reply with your order number',
  },

  // 23-25: Explicit human representative requests in multiple languages
  {
    id: 'msg_23_human_en',
    description: 'English human support request',
    message: 'I want to talk to a human agent please',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'human_handoff',
    expectedHandoffReason: 'human_requested',
    expectedResponseSnippet: 'transferred your request to our human support team',
  },
  {
    id: 'msg_24_human_es',
    description: 'Spanish human support request',
    message: 'Quiero hablar con un agente humano por favor',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'es',
    expectedOutcome: 'human_handoff',
    expectedHandoffReason: 'human_requested',
    expectedResponseSnippet: 'equipo de soporte humano',
  },
  {
    id: 'msg_25_human_pt',
    description: 'Portuguese human support request',
    message: 'Preciso falar com um atendente humano',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'pt',
    expectedOutcome: 'human_handoff',
    expectedHandoffReason: 'human_requested',
    expectedResponseSnippet: 'equipe de suporte humano',
  },

  // 26-27: Refund and cancellation requests
  {
    id: 'msg_26_refund_en',
    description: 'English refund/cancellation request',
    message: 'I want to cancel my order and get a full refund immediately',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'refund_handoff',
    expectedHandoffReason: 'refund_request',
    expectedResponseSnippet: 'human support team',
  },
  {
    id: 'msg_27_refund_es',
    description: 'Spanish refund request',
    message: 'Deseo cancelar mi pedido y solicitar un reembolso completo',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'es',
    expectedOutcome: 'refund_handoff',
    expectedHandoffReason: 'refund_request',
    expectedResponseSnippet: 'equipo de soporte humano',
  },

  // 28: Angry customer complaint
  {
    id: 'msg_28_angry_customer',
    description: 'Angry customer calling store a scam',
    message: 'This store is a complete scam! I have been waiting 3 weeks and nobody answers!',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'angry_customer_handoff',
    expectedHandoffReason: 'angry_customer',
    expectedResponseSnippet: 'human support team',
  },

  // 29-30: Unclear messages
  {
    id: 'msg_29_unclear_gibberish',
    description: 'Gibberish message',
    message: 'purple elephants flying in the sky today',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'unclear_handoff',
    expectedHandoffReason: 'unclear_intent',
    expectedResponseSnippet: 'human support team',
  },
  {
    id: 'msg_30_unclear_short',
    description: 'Short ambiguous message',
    message: 'ok thanks bye',
    senderPhone: '+15559998888',
    businessPhone: '+15550001111',
    expectedLanguage: 'en',
    expectedOutcome: 'unclear_handoff',
    expectedHandoffReason: 'unclear_intent',
    expectedResponseSnippet: 'human support team',
  },
];
