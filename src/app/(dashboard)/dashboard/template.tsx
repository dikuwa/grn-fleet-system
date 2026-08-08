export default function DashboardPageTemplate({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="page-enter">{children}</div>;
}
