import {
  createCollectingRequest,
  getCollectingRequest,
  submitRequest,
  updateCollectingRequest,
  type CustomerServiceChannel,
  type CustomerServiceRequest,
  type CustomerServiceRequestType,
} from './customer-service-requests.js';

export interface CustomerServiceRequestFlowInput {
  message: string;
  channel: CustomerServiceChannel;
  contactId: string;
}

export interface CustomerServiceRequestFlowResult {
  handled: boolean;
  answer?: string;
  requestId?: number;
  completed?: boolean;
}

const normalize = (
  value: string,
): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const isUnknownValue = (
  value: string,
): boolean =>
  /^(nao sei|não sei|nao sabe|não sabe|nao tenho|não tenho|desconheco|desconheço|ignoro)$/i.test(
    value.trim(),
  );

const cleanValue = (
  value: string,
): string =>
  value.trim().slice(0, 2000);

const inferRecipient = (
  text: string,
): string | null => {
  if (
    /\b(pastor|pr|pb)\s*moraes\b/.test(text) ||
    /\bmoraes\b/.test(text)
  ) {
    return 'Pastor Moraes';
  }

  if (
    /\b(bispo|bp)\s*sergio\b/.test(text) ||
    /\bsergio\b/.test(text)
  ) {
    return 'Bispo Sergio';
  }

  return null;
};

const detectNewRequest = (
  message: string,
): {
  type: CustomerServiceRequestType;
  recipient: string | null;
} | null => {
  const text =
    normalize(message);

  const wantsVisit =
    /\b(solicitar|pedir|quero|preciso|gostaria|agendar)\b.*\bvisita\b/.test(
      text,
    ) ||
    /\bvisita\b.*\b(preso|presa|presidio|familiar|filho|filha|marido|esposa)\b/.test(
      text,
    );

  if (wantsVisit) {
    return {
      type: 'visit',
      recipient: null,
    };
  }

  const recipient =
    inferRecipient(text);

  const wantsMessage =
    /\b(recado|mensagem|pedido|solicitacao|solicitação)\b.*\b(pastor|bispo|moraes|sergio|unp)\b/.test(
      text,
    ) ||
    /\b(quero|preciso|gostaria)\b.*\b(falar|deixar|mandar|passar)\b.*\b(pastor|bispo|moraes|sergio|unp)\b/.test(
      text,
    );

  if (wantsMessage) {
    return {
      type: 'pastoral_message',
      recipient:
        recipient ??
        'Equipe pastoral da UNP',
    };
  }

  const wantsOtherHelp =
    /\b(quero|preciso|gostaria)\b.*\b(ajuda|pedido|atendimento|orientacao|orientação)\b.*\b(unp|igreja|pastor|missionario|missionária|missionaria)\b/.test(
      text,
    );

  if (wantsOtherHelp) {
    return {
      type: 'other',
      recipient:
        'Equipe pastoral da UNP',
    };
  }

  return null;
};

const firstFieldFor = (
  type: CustomerServiceRequestType,
): string => {
  if (
    type === 'visit' ||
    type === 'pastoral_message' ||
    type === 'other'
  ) {
    return 'requesterName';
  }

  return 'requesterName';
};

const questionForField = (
  request: CustomerServiceRequest,
): string => {
  switch (request.currentField) {
    case 'requesterName':
      return 'Qual é o seu nome?';

    case 'contactWhatsapp':
      return 'Qual WhatsApp podemos usar para entrar em contato com você?';

    case 'address':
      return 'Qual é o seu endereço?';

    case 'prisonerName':
      return 'Qual é o nome do seu familiar que está preso?';

    case 'prisonName':
      return 'Em qual presídio ele(a) está?';

    case 'gallery':
      return 'Você sabe informar a galeria? Se não souber, pode dizer “não sei”.';

    case 'sectorModule':
      return 'Você sabe informar o raio ou módulo? Se não souber, pode dizer “não sei”.';

    case 'cell':
      return 'Você sabe informar o número da cela? Se não souber, pode dizer “não sei”.';

    case 'description':
      if (
        request.recipient &&
        request.recipient !==
          'Equipe pastoral da UNP'
      ) {
        return `Pode me dizer qual recado ou pedido você gostaria de deixar para ${request.recipient}?`;
      }

      return 'Pode me explicar brevemente o seu pedido para a equipe da UNP?';

    default:
      return 'Pode continuar, por favor.';
  }
};

const nextFieldForVisit = (
  current: string,
): string | null => {
  const fields = [
    'requesterName',
    'contactWhatsapp',
    'address',
    'prisonerName',
    'prisonName',
    'gallery',
    'sectorModule',
    'cell',
  ];

  const index =
    fields.indexOf(current);

  if (
    index < 0 ||
    index === fields.length - 1
  ) {
    return null;
  }

  return fields[index + 1] ?? null;
};

const nextFieldForPastoral = (
  current: string,
): string | null => {
  const fields = [
    'requesterName',
    'contactWhatsapp',
    'description',
  ];

  const index =
    fields.indexOf(current);

  if (
    index < 0 ||
    index === fields.length - 1
  ) {
    return null;
  }

  return fields[index + 1] ?? null;
};

const nextField = (
  request: CustomerServiceRequest,
): string | null => {
  if (request.type === 'visit') {
    return nextFieldForVisit(
      request.currentField ?? '',
    );
  }

  return nextFieldForPastoral(
    request.currentField ?? '',
  );
};

const fieldValue = (
  currentField: string,
  message: string,
): string | null => {
  if (
    (
      currentField === 'gallery' ||
      currentField === 'sectorModule' ||
      currentField === 'cell'
    ) &&
    isUnknownValue(message)
  ) {
    return null;
  }

  return cleanValue(message);
};

const validationMessage = (
  field: string,
  value: string,
): string | null => {
  if (
    field === 'requesterName' &&
    value.trim().length < 2
  ) {
    return 'Pode me informar seu nome, por favor?';
  }

  if (
    field === 'contactWhatsapp'
  ) {
    const digits =
      value.replace(/\D/g, '');

    if (
      digits.length < 10 ||
      digits.length > 13
    ) {
      return 'Pode informar um número de WhatsApp com DDD, por favor?';
    }
  }

  if (
    field === 'description' &&
    value.trim().length < 3
  ) {
    return 'Pode me explicar um pouco melhor o seu pedido?';
  }

  return null;
};

const updateFieldName = (
  currentField: string,
): string => {
  switch (currentField) {
    case 'requesterName':
      return 'requesterName';

    case 'contactWhatsapp':
      return 'contactWhatsapp';

    case 'address':
      return 'address';

    case 'prisonerName':
      return 'prisonerName';

    case 'prisonName':
      return 'prisonName';

    case 'gallery':
      return 'gallery';

    case 'sectorModule':
      return 'sectorModule';

    case 'cell':
      return 'cell';

    case 'description':
      return 'description';

    default:
      throw new Error(
        `Campo de coleta desconhecido: ${currentField}`,
      );
  }
};

const completionAnswer = (
  request: CustomerServiceRequest,
): string => {
  if (request.type === 'visit') {
    return [
      'Pronto. Registrei o seu pedido de visita para a equipe da UNP.',
      `O número da solicitação é ${request.id}.`,
    ].join(' ');
  }

  if (
    request.recipient &&
    request.recipient !==
      'Equipe pastoral da UNP'
  ) {
    return [
      `Pronto. Registrei o seu recado para ${request.recipient}.`,
      `O número da solicitação é ${request.id}.`,
    ].join(' ');
  }

  return [
    'Pronto. Registrei o seu pedido para a equipe pastoral da UNP.',
    `O número da solicitação é ${request.id}.`,
  ].join(' ');
};

export const handleCustomerServiceRequestFlow =
  async (
    input: CustomerServiceRequestFlowInput,
  ): Promise<CustomerServiceRequestFlowResult> => {
    const message =
      cleanValue(input.message);

    /*
     * Uma solicitação em andamento sempre tem prioridade.
     * Assim o usuário pode responder um campo por vez.
     */
    let request =
      await getCollectingRequest(
        input.channel,
        input.contactId,
      );

    if (!request) {
      const detected =
        detectNewRequest(message);

      if (!detected) {
        return {
          handled: false,
        };
      }

      request =
        await createCollectingRequest({
          type:
            detected.type,
          channel:
            input.channel,
          contactId:
            input.contactId,
          recipient:
            detected.recipient,
          currentField:
            firstFieldFor(
              detected.type,
            ),
        });

      const intro =
        detected.type === 'visit'
          ? 'Vou registrar o seu pedido de visita para a equipe da UNP.'
          : detected.recipient &&
              detected.recipient !==
                'Equipe pastoral da UNP'
            ? `Claro. Vou registrar o seu recado para ${detected.recipient}.`
            : 'Claro. Vou registrar o seu pedido para a equipe pastoral da UNP.';

      return {
        handled: true,
        requestId:
          request.id,
        answer: [
          intro,
          questionForField(request),
        ].join(' '),
      };
    }

    const currentField =
      request.currentField;

    if (!currentField) {
      return {
        handled: false,
      };
    }

    const validation =
      validationMessage(
        currentField,
        message,
      );

    if (validation) {
      return {
        handled: true,
        requestId:
          request.id,
        answer:
          validation,
      };
    }

    const value =
      fieldValue(
        currentField,
        message,
      );

    const followingField =
      nextField(request);

    request =
      await updateCollectingRequest(
        request.id,
        {
          [updateFieldName(
            currentField,
          )]:
            value,

          currentField:
            followingField,
        },
      );

    if (followingField) {
      return {
        handled: true,
        requestId:
          request.id,
        answer:
          questionForField(
            request,
          ),
      };
    }

    request =
      await submitRequest(
        request.id,
      );

    return {
      handled: true,
      requestId:
        request.id,
      completed: true,
      answer:
        completionAnswer(
          request,
        ),
    };
  };
