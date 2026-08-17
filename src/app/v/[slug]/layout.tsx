import type { ReactNode } from 'react';
import styles from './verification-header.module.css';

export default function VerificationRouteLayout({ children }: { children: ReactNode }) {
  return <div className={styles.scope}>{children}</div>;
}
