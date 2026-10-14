import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '人像灵感库',
  description: '私人摄影灵感收藏、分类与拍摄筹备空间',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
