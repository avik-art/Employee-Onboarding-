// Default documents, policies, and their text. Editable live by super-admins
// (stored in the Settings tab); these are the fallback/seed values.
const DOCUMENTS = [
  'Offer Letter', 'Non-Disclosure Agreement', 'Employee Handbook',
  'Code of Conduct', 'Equipment & Platform Policy', 'Intellectual Property Assignment'
];
const POLICIES = [
  'Data & Privacy Policy', 'Information Security Policy',
  'Remote & Hybrid Work Policy', 'Wellbeing & Anti-Harassment Policy'
];

const DOC_CONTENT = {
  'Offer Letter': { intro: 'This letter sets out our offer of employment to you and the key terms of your engagement with {{company}}.', sections: [
    { h: '1. Position & start date', p: 'We are pleased to offer you the role described in your onboarding record, commencing on your stated date of joining. Your appointment is full-time unless agreed otherwise in writing.' },
    { h: '2. Compensation & benefits', p: 'Your remuneration, benefits, and reporting line are detailed in the annexure shared with you separately, subject to applicable statutory deductions.' },
    { h: '3. Acceptance', p: 'By signing below you accept this offer and confirm the start date in your onboarding record.' } ] },
  'Non-Disclosure Agreement': { intro: 'This Agreement governs your handling of confidential information belonging to {{company}}, its clients, and the people we serve.', sections: [
    { h: '1. Confidential information', p: 'All non-public information you access in your role, including business, technical, financial, and guest data handled through our platform.' },
    { h: '2. Your obligations', p: 'You agree to keep confidential information secret and use it solely to perform your role, during and after your employment.' } ] },
  'Employee Handbook': { intro: 'The Handbook describes our shared expectations and the everyday practices that keep our team kind and effective.', sections: [
    { h: '1. How we work', p: 'We work with care, candour, and respect, and we protect the trust people place in us.' },
    { h: '2. Acknowledgement', p: 'By signing, you confirm you have read the Handbook and agree to follow it.' } ] },
  'Code of Conduct': { intro: 'Our Code sets the standards we hold ourselves to: integrity, respect, and care for the people we serve and each other.', sections: [
    { h: '1. Acting with integrity', p: 'Act lawfully and ethically, and avoid conflicts of interest.' },
    { h: '2. Respect & safety', p: 'Treat colleagues and the people we serve with dignity and help maintain a safe, inclusive workplace.' } ] },
  'Equipment & Platform Policy': { intro: 'This policy covers your access to {{company}} devices and our platform, including any guest data you handle.', sections: [
    { h: '1. Responsible use', p: 'Use equipment and access responsibly and only for your role. Access is revoked when your role changes or ends.' },
    { h: '2. Guest data', p: 'Follow our security practices and protect guest data at all times.' } ] },
  'Intellectual Property Assignment': { intro: 'This document confirms ownership of intellectual property you create in the course of your employment.', sections: [
    { h: '1. Assignment', p: 'IP you create in the course of your employment, relating to {{company}}\u2019s business, is assigned to and owned by {{company}}.' },
    { h: '2. Survival', p: 'This clause survives the end of your employment.' } ] }
};

const POLICY_CONTENT = {
  'Data & Privacy Policy': { summary: 'How we collect, use, and protect personal and guest data.', body: 'We handle personal and guest data lawfully, fairly, and only for the purposes you have been told about. You agree to follow our data-handling practices and report any incident promptly.' },
  'Information Security Policy': { summary: 'Passwords, devices, and keeping access safe.', body: 'Use strong, unique credentials, keep your devices secure and updated, and never share access. Report lost devices or suspected breaches immediately.' },
  'Remote & Hybrid Work Policy': { summary: 'Working hours, availability, and where you work.', body: 'Be reachable during agreed hours, keep a safe and private workspace when handling guest data, and follow the equipment policy wherever you work.' },
  'Wellbeing & Anti-Harassment Policy': { summary: 'A kind, safe, respectful workplace for everyone.', body: 'We are committed to a workplace free of harassment and discrimination. Treat colleagues and the people we serve with respect, and use the support channels available to you.' }
};

function defaultPortal() {
  return {
    company: process.env.COMPANY || 'Healthy Mind by Avik',
    linkTtlDays: parseInt(process.env.LINK_TTL_DAYS || '7', 10),
    collectDetails: true,
    emails: {
      inviteSubject: 'Welcome to {{company}} \u2014 your onboarding',
      inviteBody: 'Welcome, {{firstName}} \uD83C\uDF3F\n\nWe\u2019re so glad you\u2019re joining us. Please complete your joining paperwork through your secure link below \u2014 it takes about 15 minutes.\n\n{{link}}\n\nThis is a private, single-use link for you. It expires on {{expires}}.',
      completionSubject: 'You\u2019re all set \u2014 welcome to {{company}}',
      completionBody: 'You\u2019re all set \uD83C\uDF3F\n\nThank you, {{firstName}}. Your documents are signed and your policy acknowledgements are recorded. Signed copies are saved to your onboarding folder.\n\nWe can\u2019t wait to work with you.'
    },
    roleSets: [],
    zoho: { enabled: false, dc: process.env.ZOHO_DC || 'in', parentFolderId: process.env.ZOHO_PARENT_FOLDER_ID || '' },
    esign: { enabled: false, provider: 'leegality', signType: 'AADHAAR', documents: ['Offer Letter', 'Non-Disclosure Agreement', 'Intellectual Property Assignment'] },
    documents: DOCUMENTS.map(n => ({ name: n, intro: DOC_CONTENT[n].intro, sections: DOC_CONTENT[n].sections })),
    policies: POLICIES.map(n => ({ name: n, summary: POLICY_CONTENT[n].summary, body: POLICY_CONTENT[n].body }))
  };
}

module.exports = { DOCUMENTS, POLICIES, DOC_CONTENT, POLICY_CONTENT, defaultPortal };
