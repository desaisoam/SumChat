export const metadata = {
  title: "SumChat",
  description: "Neuroadaptive Agent prototype with EEG-driven engagement",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, height: "100vh", fontFamily: "ui-sans-serif, system-ui, Arial" }}>{children}</body>
    </html>
  );
}

