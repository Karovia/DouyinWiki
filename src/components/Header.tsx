import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, X } from 'lucide-react';
import type { MtaCategory } from '../trpc';

interface HeaderProps {
  currentView: 'import' | 'list' | 'mta';
  onNavigate: (view: 'import' | 'list' | 'mta', subCategory?: MtaCategory | 'all') => void;
  mtaSubCategory?: MtaCategory | 'all';
}

const mainNavItems = [
  { key: 'import', label: '导入视频' },
  { key: 'list', label: 'Wiki列表' },
  { key: 'mta', label: 'MTA' },
] as const;

const mtaSubNavItems = [
  { key: 'training', label: '健身' },
  { key: 'recipes', label: '烹饪' },
  { key: 'planning', label: '旅游规划' },
  { key: 'research', label: '深度研究' },
] as const;

export function Header({ currentView, onNavigate, mtaSubCategory = 'training' }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  const handleNav = (view: 'import' | 'list' | 'mta', sub?: MtaCategory | 'all') => {
    onNavigate(view, sub);
    setMenuOpen(false);
  };

  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="sticky top-0 z-50 border-b border-[#EAEAEA] bg-white"
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 md:px-12">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <motion.div
            className="flex items-center gap-2"
            whileHover={{ scale: 1.02 }}
          >
            <img
              src="/logo.png"
              alt="Logo"
              className="h-9 w-9 rounded-lg object-cover sm:h-11 sm:w-11"
            />
            <span className="text-[16px] font-bold tracking-tight text-[#1A1A1A] sm:text-[18px]">
              抖音 Wiki
            </span>
          </motion.div>

          {/* Desktop Main Navigation */}
          <nav className="hidden sm:flex gap-3 text-[15px] font-medium">
            {mainNavItems.map((item) => (
              <motion.button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`relative rounded-full px-5 py-2 transition-colors ${
                  currentView === item.key
                    ? 'bg-[#2C2C2C] text-white'
                    : 'bg-[#F5F5F5] text-[#8C8C8C] hover:text-[#2C2C2C] hover:bg-[#EAEAEA]'
                }`}
              >
                {item.label}
              </motion.button>
            ))}
          </nav>

          {/* Mobile Menu Button */}
          <div className="relative sm:hidden" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-[#FAFAFA] transition-colors"
              aria-label="菜单"
            >
              {menuOpen ? <X className="w-5 h-5 text-[#1A1A1A]" /> : <Menu className="w-5 h-5 text-[#1A1A1A]" />}
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-52 bg-white border border-[#EAEAEA] rounded-xl shadow-lg py-2 overflow-hidden"
                >
                  {/* Main nav items */}
                  {mainNavItems.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => handleNav(item.key)}
                      className={`w-full text-left px-4 py-2.5 text-[14px] font-medium transition-colors ${
                        currentView === item.key
                          ? 'text-[#2C2C2C] bg-[#FAFAFA]'
                          : 'text-[#8C8C8C] hover:text-[#2C2C2C] hover:bg-[#FAFAFA]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}

                  {/* MTA Sub nav inside dropdown */}
                  {currentView === 'mta' && (
                    <>
                      <div className="my-1 mx-3 h-px bg-[#EAEAEA]" />
                      <div className="px-3 py-1 text-[12px] text-[#8C8C8C] font-medium">MTA 板块</div>
                      {mtaSubNavItems.map((item) => (
                        <button
                          key={item.key}
                          onClick={() => handleNav('mta', item.key)}
                          className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${
                            mtaSubCategory === item.key
                              ? 'text-[#2C2C2C] bg-[#FAFAFA]'
                              : 'text-[#8C8C8C] hover:text-[#2C2C2C] hover:bg-[#FAFAFA]'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Desktop MTA Sub Navigation */}
        {currentView === 'mta' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="hidden sm:block border-t border-[#EAEAEA] py-2"
          >
            <nav className="flex gap-2 text-[13px] font-medium">
              {mtaSubNavItems.map((item) => (
                <motion.button
                  key={item.key}
                  onClick={() => onNavigate('mta', item.key)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`relative rounded-full px-4 py-1.5 transition-colors ${
                    mtaSubCategory === item.key
                      ? 'bg-[#2C2C2C] text-white'
                      : 'bg-[#F5F5F5] text-[#8C8C8C] hover:text-[#2C2C2C] hover:bg-[#EAEAEA]'
                  }`}
                >
                  {item.label}
                </motion.button>
              ))}
            </nav>
          </motion.div>
        )}
      </div>
    </motion.header>
  );
}
