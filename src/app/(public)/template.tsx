export default function PublicPageTemplate({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="page-enter">{children}</div>;
}
