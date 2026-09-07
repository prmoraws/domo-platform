import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCustomerServiceRule,
} from './customer-service-rules.js';

test('orienta envio de áudio', () => {
  const result = resolveCustomerServiceRule({
    message:
      'Quero mandar uma mensagem para meu filho que está preso',
  });

  assert.equal(result.matched, true);
  assert.equal(result.rule, 'send_audio');
  assert.match(result.answer ?? '', /20 segundos/);
  assert.match(result.answer ?? '', /Telegram/i);
});

test('orienta sobre conteúdo somente quando perguntado', () => {
  const result = resolveCustomerServiceRule({
    message: 'O que eu falo no áudio?',
  });

  assert.equal(result.rule, 'audio_content');
  assert.match(
    result.answer ?? '',
    /carinho e conforto/,
  );
});

test('informa telefone correto para participação ao vivo', () => {
  const result = resolveCustomerServiceRule({
    message: 'Quero participar ao vivo do programa',
  });

  assert.equal(result.rule, 'live_program');
  assert.match(
    result.answer ?? '',
    /\(71\) 3432-9110/,
  );
});

test('informa telefone pastoral separado', () => {
  const result = resolveCustomerServiceRule({
    message: 'Preciso conversar com um pastor',
  });

  assert.equal(result.rule, 'pastoral_support');
  assert.match(
    result.answer ?? '',
    /\(71\) 3432-9119/,
  );
});

test('não inventa informações do sistema prisional', () => {
  const result = resolveCustomerServiceRule({
    message:
      'Quero saber quando será a audiência do meu marido',
  });

  assert.equal(
    result.rule,
    'prison_information',
  );

  assert.match(
    result.answer ?? '',
    /advogado/,
  );

  assert.match(
    result.answer ?? '',
    /assistente social/,
  );
});

test('explica que texto não é lido no ar', () => {
  const result = resolveCustomerServiceRule({
    message:
      'Posso mandar uma mensagem escrita para ler no programa?',
  });

  assert.equal(
    result.rule,
    'text_not_on_air',
  );

  assert.match(
    result.answer ?? '',
    /não são lidas no ar/,
  );
});

test('inclui saudação somente na primeira interação', () => {
  const first = resolveCustomerServiceRule({
    message: 'Que horas começa o programa?',
    firstInteraction: true,
    localTime: '19:30',
  });

  assert.match(
    first.answer ?? '',
    /^Boa noite!/,
  );

  assert.match(
    first.answer ?? '',
    /Missionária Virtual da UNP/,
  );

  const second = resolveCustomerServiceRule({
    message: 'Que horas começa o programa?',
    firstInteraction: false,
    localTime: '19:30',
  });

  assert.doesNotMatch(
    second.answer ?? '',
    /^Boa noite!/,
  );
});

test('informa programa gravado em feriado quando pertinente', () => {
  const result = resolveCustomerServiceRule({
    message: 'Que horas passa o programa hoje?',
    isHoliday: true,
  });

  assert.match(
    result.answer ?? '',
    /programa é gravado/,
  );
});

test('pergunta não coberta segue para o assistente de IA', () => {
  const result = resolveCustomerServiceRule({
    message: 'Conte um pouco sobre a história da UNP',
  });

  assert.equal(result.matched, false);
});

test('responde saudação inicial sem chamar IA', () => {
  const result = resolveCustomerServiceRule({
    message: 'Boa noite',
    firstInteraction: true,
    localTime: '20:30',
  });

  assert.equal(
    result.rule,
    'initial_greeting',
  );

  assert.equal(
    result.answer,
    [
      'Boa noite!',
      'Sou a Missionária Virtual da UNP. Como posso ajudar?',
    ].join('\n'),
  );
});

test('explica a UNP sem misturar outros públicos', () => {
  const result = resolveCustomerServiceRule({
    message: 'O que é a UNP?',
  });

  assert.equal(result.rule, 'about_unp');

  assert.match(
    result.answer ?? '',
    /pessoas privadas de liberdade/,
  );

  assert.match(
    result.answer ?? '',
    /familiares/,
  );

  assert.doesNotMatch(
    result.answer ?? '',
    /policiais|agentes|funcionários/i,
  );
});

test('não promete transmissão de mensagem escrita', () => {
  const result = resolveCustomerServiceRule({
    message: 'Posso mandar escrito?',
  });

  assert.equal(
    result.rule,
    'text_not_on_air',
  );

  assert.match(
    result.answer ?? '',
    /não são lidas no ar/,
  );

  assert.doesNotMatch(
    result.answer ?? '',
    /será transmitid/i,
  );
});

test('informa que o WhatsApp não atende ligações', () => {
  const result = resolveCustomerServiceRule({
    message: 'Posso ligar nesse número?',
  });

  assert.equal(
    result.rule,
    'whatsapp_no_calls',
  );

  assert.match(
    result.answer ?? '',
    /não atende ligações/,
  );
});

test('orienta como ouvir pela rádio', () => {
  const result = resolveCustomerServiceRule({
    message: 'Como faço para ouvir o programa?',
  });

  assert.equal(
    result.rule,
    'how_to_listen',
  );

  assert.match(
    result.answer ?? '',
    /95\.9/,
  );
});

test('informa Catedral da Fé quando perguntado', () => {
  const result = resolveCustomerServiceRule({
    message: 'Qual o endereço da igreja?',
  });

  assert.equal(
    result.rule,
    'church_invitation',
  );

  assert.match(
    result.answer ?? '',
    /Antônio Carlos Magalhães, 4197/,
  );
});

test('entende forma natural de perguntar como ouvir', () => {
  const examples = [
    'Como faço para ouvir o programa?',
    'Onde posso ouvir o programa?',
    'Onde passa o Momento do Presidiário?',
    'Qual é a rádio?',
    'Qual é a frequência?',
  ];

  for (const message of examples) {
    const result =
      resolveCustomerServiceRule({
        message,
      });

    assert.equal(
      result.rule,
      'how_to_listen',
      `Falhou para: ${message}`,
    );

    assert.match(
      result.answer ?? '',
      /95\.9/,
    );
  }
});

test('informa que Telegram continua recebendo áudios', () => {
  const examples = [
    'O Telegram ainda recebe os áudios?',
    'Posso continuar mandando pelo Telegram?',
    'O Telegram continua funcionando?',
  ];

  for (const message of examples) {
    const result =
      resolveCustomerServiceRule({ message });

    assert.equal(
      result.rule,
      'telegram',
      `Falhou para: ${message}`,
    );

    assert.match(
      result.answer ?? '',
      /Telegram/i,
    );

    assert.match(
      result.answer ?? '',
      /recebendo os áudios/i,
    );
  }
});

test('não promete transmissão em data específica', () => {
  const examples = [
    'Aniversário dele é amanhã',
    'Quero que passe no dia 16',
    'Pode transmitir no dia do aniversário?',
  ];

  for (const message of examples) {
    const result =
      resolveCustomerServiceRule({ message });

    assert.equal(
      result.rule,
      'specific_audio_date',
      `Falhou para: ${message}`,
    );

    assert.match(
      result.answer ?? '',
      /não conseguimos agendar ou garantir/i,
    );

    assert.doesNotMatch(
      result.answer ?? '',
      /será transmitido|vamos transmitir|vai passar/i,
    );
  }
});

test('agradecimentos simples são determinísticos', () => {
  for (const message of [
    'Obrigada',
    'Obrigado',
    'Obg',
    'Muito obrigada',
  ]) {
    const result =
      resolveCustomerServiceRule({ message });

    assert.equal(
      result.rule,
      'thanks',
      `Falhou para: ${message}`,
    );
  }
});

test('amém é tratado sem Gemini', () => {
  for (const message of [
    'Amém',
    'Amem',
    'Amém amém 🙏',
  ]) {
    const result =
      resolveCustomerServiceRule({ message });

    assert.equal(
      result.rule,
      'amen',
      `Falhou para: ${message}`,
    );
  }
});

test('confirmações simples são determinísticas', () => {
  for (const message of [
    'Certo',
    'Entendi',
    'Tá bom',
    'Combinado',
  ]) {
    const result =
      resolveCustomerServiceRule({ message });

    assert.equal(
      result.rule,
      'acknowledgement',
      `Falhou para: ${message}`,
    );
  }
});

test('despedidas religiosas simples são determinísticas', () => {
  for (const message of [
    'Deus abençoe',
    'Fique com Deus',
    'Tenha uma boa noite',
  ]) {
    const result =
      resolveCustomerServiceRule({ message });

    assert.equal(
      result.rule,
      'farewell',
      `Falhou para: ${message}`,
    );
  }
});

test('amém encerra silenciosamente conversa existente', () => {
  const result =
    resolveCustomerServiceRule({
      message: 'Amém',
      firstInteraction: false,
    });

  assert.equal(result.rule, 'amen');
  assert.equal(result.silent, true);
  assert.equal(result.answer, undefined);
});

test('amém na primeira interação ainda recebe acolhimento', () => {
  const result =
    resolveCustomerServiceRule({
      message: 'Amém',
      firstInteraction: true,
      localTime: '10:00',
    });

  assert.equal(result.rule, 'amen');
  assert.notEqual(result.silent, true);

  assert.match(
    result.answer ?? '',
    /Missionária Virtual da UNP/,
  );
});

test('confirmação após atendimento encerra silenciosamente', () => {
  const result =
    resolveCustomerServiceRule({
      message: 'Certo',
      firstInteraction: false,
    });

  assert.equal(
    result.rule,
    'acknowledgement',
  );

  assert.equal(
    result.silent,
    true,
  );
});

test('orienta canal preferencial para envio do áudio', () => {
  const examples = [
    'Por onde eu mando a mensagem',
    'Onde mando o áudio?',
    'Como faço para enviar o recado?',
  ];

  for (const message of examples) {
    const result =
      resolveCustomerServiceRule({
        message,
        firstInteraction: false,
      });

    assert.equal(
      result.rule,
      'send_audio',
      `Falhou para: ${message}`,
    );

    assert.match(
      result.answer ?? '',
      /preferencialmente.*Telegram/i,
    );

    assert.match(
      result.answer ?? '',
      /Telegram/i,
    );

    assert.match(
      result.answer ?? '',
      /WhatsApp também recebe/i,
    );

    assert.match(
      result.answer ?? '',
      /quando.*anunciado/i,
    );
  }
});

test('Telegram é informado como canal preferencial', () => {
  const result =
    resolveCustomerServiceRule({
      message:
        'Ainda posso mandar os áudios pelo Telegram?',
      firstInteraction: false,
    });

  assert.equal(
    result.rule,
    'telegram',
  );

  assert.match(
    result.answer ?? '',
    /canal preferencial/i,
  );

  assert.match(
    result.answer ?? '',
    /WhatsApp também recebe/i,
  );
});

test('interrogação isolada não chama Gemini em conversa existente', () => {
  for (const message of [
    '?',
    '??',
    '?!',
  ]) {
    const result =
      resolveCustomerServiceRule({
        message,
        firstInteraction: false,
      });

    assert.equal(
      result.rule,
      'punctuation_only',
    );

    assert.equal(
      result.silent,
      true,
    );
  }
});

test('entende abreviações sobre horário de envio', () => {
  const examples = [
    'Q horas posso mandar',
    'Que horas posso mandar',
    'Qual horário posso mandar',
    'Hj envia?',
    'Hoje envia?',
    'Q horas posso mandar?',
    'Qual horário posso mandar?',
  ];

  for (const message of examples) {
    const result =
      resolveCustomerServiceRule({
        message,
        firstInteraction: false,
      });

    assert.equal(
      result.rule,
      'audio_sending_time',
      `Falhou para: ${message}`,
    );

    assert.match(
      result.answer ?? '',
      /21h e 22h/i,
    );


  }
});

test('informa que áudio enviado hoje passa no programa do dia seguinte', () => {
  const messages = [
    'Meu áudio vai passar hoje?',
    'O áudio vai passar hoje?',
    'O áudio que mandei hoje vai passar hoje?',
  ];

  for (const message of messages) {
    const result =
      resolveCustomerServiceRule({
        message,
        firstInteraction: false,
        isHoliday: false,
        localTime: '16:30',
      });

    assert.equal(
      result.rule,
      'audio_airs_next_day',
      `Falhou para: ${message}`,
    );

    assert.match(
      result.answer ?? '',
      /enviado hoje vai para produção/i,
    );

    assert.match(
      result.answer ?? '',
      /programa do dia seguinte/i,
    );
  }
});

test('permite enviar áudio hoje sem transformar orientação geral em promessa', () => {
  const messages = [
    'Posso enviar hoje?',
    'Posso mandar o áudio hoje?',
    'Hoje posso enviar?',
  ];

  for (const message of messages) {
    const result =
      resolveCustomerServiceRule({
        message,
        firstInteraction: false,
        isHoliday: false,
        localTime: '16:30',
      });

    assert.equal(
      result.rule,
      'can_send_audio_today',
      `Falhou para: ${message}`,
    );

    assert.match(
      result.answer ?? '',
      /^Sim\. Você pode enviar o áudio hoje\./,
    );

    assert.match(
      result.answer ?? '',
      /programa do dia seguinte/i,
    );
  }
});

test('em feriado permite envio hoje e informa veiculação amanhã', () => {
  const result =
    resolveCustomerServiceRule({
      message: 'Posso enviar o áudio hoje?',
      firstInteraction: false,
      isHoliday: true,
      localTime: '16:30',
    });

  assert.equal(
    result.rule,
    'can_send_audio_today',
  );

  assert.match(
    result.answer ?? '',
    /hoje é feriado/i,
  );

  assert.match(
    result.answer ?? '',
    /programa está gravado/i,
  );

  assert.match(
    result.answer ?? '',
    /passa amanhã no programa/i,
  );
});

test('orientação genérica de envio não informa espontaneamente dia seguinte', () => {
  const result =
    resolveCustomerServiceRule({
      message: 'Como eu mando uma mensagem para meu filho preso?',
      firstInteraction: false,
      isHoliday: false,
      localTime: '16:30',
    });

  assert.equal(
    result.rule,
    'send_audio',
  );

  assert.doesNotMatch(
    result.answer ?? '',
    /dia seguinte|amanhã/i,
  );
});

test('apresenta Missionária Virtual da UNP na primeira interação', () => {
  const result =
    resolveCustomerServiceRule({
      message: 'Olá',
      firstInteraction: true,
      localTime: '10:00',
      channel: 'telegram',
    });

  assert.equal(
    result.rule,
    'initial_greeting',
  );

  assert.match(
    result.answer ?? '',
    /Missionária Virtual da UNP/,
  );

  assert.match(
    result.answer ?? '',
    /Como posso ajudar\?/,
  );
});

test('responde de forma curta quando perguntam se pode enviar agora', () => {
  const result =
    resolveCustomerServiceRule({
      message: 'Posso enviar áudio agora?',
      firstInteraction: false,
      channel: 'telegram',
    });

  assert.equal(
    result.rule,
    'can_send_audio_now',
  );

  assert.equal(
    result.answer,
    'Sim, pode enviar o áudio agora.',
  );
});

test('no Telegram orienta envio pelo próprio canal', () => {
  const result =
    resolveCustomerServiceRule({
      message: 'Como faço para enviar um áudio para meu familiar?',
      firstInteraction: false,
      channel: 'telegram',
    });

  assert.equal(
    result.rule,
    'send_audio',
  );

  assert.match(
    result.answer ?? '',
    /por aqui mesmo/i,
  );

  assert.doesNotMatch(
    result.answer ?? '',
    /Preferencialmente.*Telegram/i,
  );

  assert.doesNotMatch(
    result.answer ?? '',
    /Este WhatsApp/i,
  );
});

test('no WhatsApp preserva orientação para Telegram preferencial', () => {
  const result =
    resolveCustomerServiceRule({
      message: 'Como faço para enviar um áudio para meu familiar?',
      firstInteraction: false,
      channel: 'whatsapp',
    });

  assert.equal(
    result.rule,
    'send_audio',
  );

  assert.match(
    result.answer ?? '',
    /Preferencialmente.*Telegram/i,
  );
});
