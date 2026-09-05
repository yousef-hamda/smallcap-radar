import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'رادار | Small-Cap Radar',description:'مساحة بحث عربية للشركات الصغيرة، مبنية على أدلة وقواعد واضحة.',manifest:'/manifest.webmanifest',icons:{icon:'/icon.svg',apple:'/icon-192.png'},other:{'theme-color':'#102d35'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><body>{children}</body></html>}
