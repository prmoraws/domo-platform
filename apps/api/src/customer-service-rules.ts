export interface CustomerServiceRuleInput {
  message: string;
  firstInteraction?: boolean;
  isHoliday?: boolean;
  localTime?: string;
}

export interface CustomerServiceRuleResult {
  matched: boolean;
  answer?: string;
  rule?: string;
  silent?: boolean;
}

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const greetingForTime = (
  localTime?: string,
): string => {
  const hour = Number(
    String(localTime ?? '').slice(0, 2),
  );

  if (
    Number.isInteger(hour) &&
    hour >= 5 &&
    hour < 12
  ) {
    return 'Bom dia!';
  }

  if (
    Number.isInteger(hour) &&
    hour >= 12 &&
    hour < 18
  ) {
    return 'Boa tarde!';
  }

  return 'Boa noite!';
};

const initialGreeting = (
  input: CustomerServiceRuleInput,
): string => [
  greetingForTime(input.localTime),
  'Programa Momento do Presidiário. Em que posso ajudar?',
].join('\n');

const withInitialGreeting = (
  answer: string,
  input: CustomerServiceRuleInput,
): string => {
  if (!input.firstInteraction) {
    return answer;
  }

  return [
    initialGreeting(input),
    '',
    answer,
  ].join('\n');
};

export const resolveCustomerServiceRule = (
  input: CustomerServiceRuleInput,
): CustomerServiceRuleResult => {
  const text = normalize(input.message);

  if (!text) {
    return {
      matched: false,
    };
  }

  // Saudação isolada na primeira interação.
  const isGreeting =
    /^(oi|ola|bom dia|boa tarde|boa noite|paz|ola boa noite|ola bom dia|ola boa tarde)[!. ]*$/.test(
      text,
    );

  if (isGreeting && input.firstInteraction) {
    return {
      matched: true,
      rule: 'initial_greeting',
      answer: initialGreeting(input),
    };
  }

  // Informações institucionais da UNP no contexto
  // específico do Momento do Presidiário.
  const asksAboutUnp =
    /\b(o que e|quem e|o que significa|fale sobre|me explique).*?\bunp\b/.test(
      text,
    ) ||
    /^(unp|universal nos presidios)[?!. ]*$/.test(
      text,
    );

  if (asksAboutUnp) {
    return {
      matched: true,
      rule: 'about_unp',
      answer: withInitialGreeting(
        [
          'A UNP — Universal nos Presídios — é um trabalho da Igreja Universal do Reino de Deus',
          'voltado à assistência espiritual de pessoas privadas de liberdade e de seus familiares.',
          'Por meio desse trabalho, buscamos levar fé, esperança, apoio e uma palavra de conforto',
          'para quem enfrenta esse momento.',
        ].join(' '),
        input,
      ),
    };
  }

  const asksPastor =
    /\b(pastor|atendimento espiritual|ajuda espiritual|orientacao espiritual)\b/.test(
      text,
    );

  if (asksPastor) {
    return {
      matched: true,
      rule: 'pastoral_support',
      answer: withInitialGreeting(
        [
          'Para falar com um pastor e receber atendimento espiritual,',
          'entre em contato pelo telefone (71) 3432-9119.',
        ].join(' '),
        input,
      ),
    };
  }

  const asksLive =
    /\b(ao vivo|ligar para o programa|participar do programa|falar no programa)\b/.test(
      text,
    );

  if (asksLive) {
    return {
      matched: true,
      rule: 'live_program',
      answer: withInitialGreeting(
        [
          'Para participar ao vivo, ligue para (71) 3432-9110',
          'de segunda a sexta-feira, durante o programa, das 21h às 22h.',
        ].join(' '),
        input,
      ),
    };
  }

  const asksCallsOnWhatsapp =
    (
      /\b(ligar|ligacao|telefonar|telefone)\b/.test(text) &&
      /\b(whatsapp|esse numero|este numero|aqui)\b/.test(text)
    ) ||
    /\b(voces atendem ligacao|atende ligacao|posso ligar)\b/.test(
      text,
    );

  if (asksCallsOnWhatsapp) {
    return {
      matched: true,
      rule: 'whatsapp_no_calls',
      answer: withInitialGreeting(
        [
          'Este WhatsApp não atende ligações.',
          'Para enviar seu recado ao programa, envie uma mensagem de áudio',
          'com até 20 segundos, entre 21h e 22h.',
          'Para participar ao vivo pelo telefone, ligue para (71) 3432-9110',
          'durante o programa, das 21h às 22h.',
        ].join(' '),
        input,
      ),
    };
  }

  const asksPrisonInformation =
    /\b(processo|audiencia|transferencia|transferido|soltura|liberdade|alvara|prontuario|situacao juridica|situacao processual|andamento processual|dia de visita|autorizacao de visita)\b/.test(
      text,
    );

  if (asksPrisonInformation) {
    return {
      matched: true,
      rule: 'prison_information',
      answer: withInitialGreeting(
        [
          'Como igreja, prestamos assistência espiritual e não temos acesso',
          'a informações processuais, jurídicas ou administrativas do sistema prisional.',
          'Para esse tipo de informação, orientamos procurar o advogado',
          'ou o assistente social da unidade prisional.',
        ].join(' '),
        input,
      ),
    };
  }

  // A intenção específica de "texto no ar" precisa
  // preceder a intenção genérica de enviar recado.
  const asksIfTextCanAir =
    /\b(texto|escrito|mensagem escrita)\b.*\b(ar|programa|ler|lida|recado|mandar|enviar)\b/.test(
      text,
    ) ||
    /\b(posso|pode)\b.*\b(mandar|enviar)\b.*\b(escrito|texto)\b/.test(
      text,
    );

  if (asksIfTextCanAir) {
    return {
      matched: true,
      rule: 'text_not_on_air',
      answer: withInitialGreeting(
        [
          'As mensagens de texto não são lidas no ar.',
          'Para participar, envie uma mensagem de áudio com até 20 segundos,',
          'entre 21h e 22h.',
        ].join(' '),
        input,
      ),
    };
  }

  const asksWhatToSay =
    /\b(o que (eu )?(falo|digo)|o que mandar no audio|o que falar no audio|como faco o audio)\b/.test(
      text,
    );

  if (asksWhatToSay) {
    return {
      matched: true,
      rule: 'audio_content',
      answer: withInitialGreeting(
        [
          'Você pode enviar uma mensagem de carinho e conforto para o seu familiar.',
          'O áudio deve ter no máximo 20 segundos e ser enviado entre 21h e 22h.',
        ].join(' '),
        input,
      ),
    };
  }

  const wantsSendMessage =
    /\b(mandar|enviar|passar)\b.*\b(audio|mensagem|recado|alo)\b/.test(
      text,
    ) ||
    /\b(mensagem|recado|audio)\b.*\b(filho|filha|marido|esposo|esposa|familiar|preso|presa|presidio|cadeia)\b/.test(
      text,
    ) ||
    /\b(filho|filha|marido|esposo|esposa|familiar)\b.*\b(preso|presa|presidio|cadeia)\b/.test(
      text,
    );

  if (wantsSendMessage) {
    const holidayNote =
      input.isHoliday === true
        ? ' Em feriados, o programa é gravado.'
        : '';

    return {
      matched: true,
      rule: 'send_audio',
      answer: withInitialGreeting(
        [
          'Para enviar uma mensagem ao seu familiar, envie um áudio por este WhatsApp.',
          'O áudio deve ter no máximo 20 segundos e ser enviado entre 21h e 22h.',
          'Não é uma conversa direta com ele(a); o áudio poderá ser utilizado durante o programa.',
          'Mensagens de texto não são lidas no ar.',
          holidayNote,
        ]
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
        input,
      ),
    };
  }

  const asksProgramSchedule =
    /\b(horario|que horas|quando passa|quando e o programa|programacao)\b/.test(
      text,
    );

  if (asksProgramSchedule) {
    const holidayNote =
      input.isHoliday === true
        ? ' Em feriados, o programa é gravado.'
        : '';

    return {
      matched: true,
      rule: 'program_schedule',
      answer: withInitialGreeting(
        [
          'O Momento do Presidiário vai ao ar pela Rede Aleluia FM 95.9,',
          'de segunda a sexta-feira, das 21h às 22h.',
          holidayNote,
        ]
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
        input,
      ),
    };
  }

  const asksHowToListen =
    /\b(como ouvir|como faco para ouvir|onde ouvir|onde escutar|onde posso ouvir|onde passa|qual radio|qual e a radio|qual frequencia|qual e a frequencia|frequencia da radio|rede aleluia|escutar o programa|ouvir o programa)\b/.test(
      text,
    );

  if (asksHowToListen) {
    return {
      matched: true,
      rule: 'how_to_listen',
      answer: withInitialGreeting(
        [
          'Você pode ouvir o Momento do Presidiário pela Rede Aleluia FM 95.9',
          'ou pelo aplicativo Portal Universal.',
        ].join(' '),
        input,
      ),
    };
  }

  const asksChurch =
    /\b(catedral|igreja|reuniao domingo|culto domingo|endereco da igreja)\b/.test(
      text,
    );

  if (asksChurch) {
    return {
      matched: true,
      rule: 'church_invitation',
      answer: withInitialGreeting(
        [
          'Você e sua família são muito bem-vindos à nossa reunião principal,',
          'aos domingos, às 9h30, na Catedral da Fé:',
          'Av. Antônio Carlos Magalhães, 4197, Iguatemi, Salvador - BA.',
        ].join(' '),
        input,
      ),
    };
  }


  // Telegram — canal oficial do Momento do Presidiário.
  const asksTelegram =
    /\btelegram\b/.test(text);

  if (asksTelegram) {
    return {
      matched: true,
      rule: 'telegram',
      answer: withInitialGreeting(
        [
          'Sim. O Telegram continua sendo o canal oficial do Momento do Presidiário',
          'e continuamos recebendo os áudios por lá normalmente.',
        ].join(' '),
        input,
      ),
    };
  }

  // Datas específicas, aniversários e pedidos para tocar em um dia.
  // Nunca prometer ou agendar transmissão de um áudio específico.
  const asksSpecificDate =
    /\b(aniversario|amanha|hoje|dia \d{1,2}|data especifica|passar no dia|tocar no dia|transmitir no dia|ser no dia)\b/.test(
      text,
    );

  if (asksSpecificDate) {
    return {
      matched: true,
      rule: 'specific_audio_date',
      answer: withInitialGreeting(
        [
          'Não conseguimos agendar ou garantir que um áudio seja utilizado em uma data específica,',
          'pois a seleção é feita manualmente pela equipe do programa.',
          'Você pode enviar o áudio de até 20 segundos entre 21h e 22h.',
        ].join(' '),
        input,
      ),
    };
  }

  // Agradecimentos.
  const isThanks =
    /^(obrigad[oa]|obg|obgd|obgda|obgdo|muito obrigad[oa]|valeu|agradeco|gratidao)([!. 🙏❤️🥰]*)$/.test(
      text,
    );

  if (isThanks) {
    return {
      matched: true,
      rule: 'thanks',
      answer: withInitialGreeting(
        'Por nada! Deus abençoe você e sua família. 🙏',
        input,
      ),
    };
  }

  // "Amém" é uma confirmação/encerramento comum.
  const isAmen =
    /^(amem)(\s+amem)*([!. 🙏]*)$/.test(
      text,
    );

  if (isAmen) {
    if (!input.firstInteraction) {
      return {
        matched: true,
        rule: 'amen',
        silent: true,
      };
    }

    return {
      matched: true,
      rule: 'amen',
      answer: withInitialGreeting(
        'Amém! 🙏',
        input,
      ),
    };
  }

  // Bênçãos e despedidas comuns.
  const isBlessingOrFarewell =
    /^(deus abencoe|fica com deus|fique com deus|bom trabalho|boa noite obrigado|boa noite obrigada|tenha um bom dia|tenha uma boa tarde|tenha uma boa noite)([!. 🙏❤️]*)$/.test(
      text,
    );

  if (isBlessingOrFarewell) {
    if (!input.firstInteraction) {
      return {
        matched: true,
        rule: 'farewell',
        silent: true,
      };
    }

    return {
      matched: true,
      rule: 'farewell',
      answer: withInitialGreeting(
        'Amém! Deus abençoe você e sua família. 🙏',
        input,
      ),
    };
  }

  // Confirmações curtas não devem chamar Gemini.
  const isAcknowledgement =
    /^(sim|certo|ok|okay|entendi|ta bom|beleza|combinado|vou fazer|vou mandar)([!. 🙏]*)$/.test(
      text,
    );

  if (isAcknowledgement) {
    if (!input.firstInteraction) {
      return {
        matched: true,
        rule: 'acknowledgement',
        silent: true,
      };
    }

    return {
      matched: true,
      rule: 'acknowledgement',
      answer: withInitialGreeting(
        'Certo! Estamos à disposição.',
        input,
      ),
    };
  }

  return {
    matched: false,
  };
};
