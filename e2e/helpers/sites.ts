import { environment } from './environment';

export const sites = [
  { name: 'staging', url: environment.stagingUrl },
  { name: 'production-laiwan.life', url: 'https://h5.laiwan.life/' },
  { name: 'production-laiwanpai.com', url: 'https://h5.laiwanpai.com/' },
  { name: 'production-goplay360.com', url: 'https://h5.goplay360.com/' },
] as const;
