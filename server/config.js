// Dados do estúdio — edite este arquivo para personalizar a marca,
// o WhatsApp, a chave Pix e o percentual do sinal.
export const BUSINESS = {
  name: 'Studio Paula Souza',
  shortName: 'Paula Souza',
  tagline: 'Lash & Nails Studio',
  eyebrow: 'Lash · Gel · Manicure & Pedicure',
  whatsapp: '5527999990000',            // somente dígitos, com DDI 55
  instagram: 'studiodapaulasouza',      // sem @
  email: 'contato@paulasouza.com.br',
  pixKey: 'contato@paulasouza.com.br', // chave Pix (e-mail, telefone, CPF/CNPJ ou aleatória)
  pixName: 'STUDIO PAULA SOUZA',
  pixCity: 'VILA VELHA',
  depositPercent: 30,
  cancelHours: 6,
  slotMinutes: 30,
  minLeadMinutes: 90,
  address: 'Atendimento exclusivo com hora marcada · Vila Velha, ES',
  hours: {
    0: null,
    1: ['09:00', '19:00'],
    2: ['09:00', '19:00'],
    3: ['09:00', '19:00'],
    4: ['09:00', '19:00'],
    5: ['09:00', '19:00'],
    6: ['09:00', '17:00']
  }
};

// Acesso administrativo criado no primeiro start.
// A senha vem de LUMIERE_ADMIN_PASSWORD; sem a variável, uma senha aleatória
// é gerada e mostrada uma única vez no console.
export const ADMIN = {
  name: 'Studio Paula Souza',
  email: 'studio@paulasouza.com.br',
  phone: '27999990000'
};

// Conta de demonstração para clientes.
export const DEMO_CLIENT = {
  email: 'cliente@demo.com',
  password: 'demo1234'
};

export const CATEGORIES = {
  cilios: { label: 'Cílios', singular: 'cílios' },
  unhas: { label: 'Unhas', singular: 'unhas' },
  manicure: { label: 'Manicure', singular: 'manicure' },
  pedicure: { label: 'Pedicure', singular: 'pedicure' }
};

export const STATUS = ['pendente', 'confirmado', 'concluido', 'cancelado', 'faltou'];
