export default function Footer() {
  return (
    <footer className="bg-surface w-full mt-auto py-12 border-t border-border-subtle">
      <div className="flex flex-col md:flex-row justify-between items-center w-full px-8 md:px-12 max-w-[1200px] mx-auto gap-6 relative">
        <div className="w-full text-center text-[12px] text-text-secondary mb-4 md:absolute md:top-[-40px] md:left-0 md:right-0 opacity-60 italic">
          慢慢来，知识值得认真对待。
        </div>
        <div className="text-[14px] text-text-secondary">
          © 2026 Douyin Wiki
        </div>
      </div>
    </footer>
  );
}
