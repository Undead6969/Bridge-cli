import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Globe, ImagePlus, Mic, Pencil, Plus, Search, Send, Sparkles, Telescope, X } from "lucide-react";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & { showArrow?: boolean }
>(({ className, sideOffset = 4, showArrow = false, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "relative z-50 max-w-[280px] rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] shadow-lg ring-1 ring-black/10 dark:ring-white/10",
        className
      )}
      {...props}
    >
      {props.children}
      {showArrow ? <TooltipPrimitive.Arrow className="fill-[var(--bg-elevated)]" /> : null}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-2xl border border-black/10 bg-[var(--bg-elevated)] p-2 text-[var(--text)] shadow-2xl dark:border-white/10",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-black/60 backdrop-blur-sm", className)} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-[min(92vw,760px)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-black/10 bg-[var(--bg-elevated)] p-2 shadow-2xl dark:border-white/10",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 rounded-full p-1 text-[var(--muted)] transition hover:bg-white/10 hover:text-[var(--text)]">
        <X className="h-5 w-5" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const toolsList = [
  { id: "createImage", name: "Create an image", shortName: "Image", icon: ImagePlus },
  { id: "searchWeb", name: "Search the web", shortName: "Search", icon: Search },
  { id: "browse", name: "Open website", shortName: "Browse", icon: Globe },
  { id: "writeCode", name: "Write code", shortName: "Code", icon: Pencil },
  { id: "deepResearch", name: "Deep research", shortName: "Research", icon: Telescope },
  { id: "thinkLonger", name: "Think longer", shortName: "Think", icon: Sparkles }
] as const;

type PromptBoxProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  mode?: "chat" | "terminal";
};

export function PromptBox({
  value,
  onValueChange,
  onSubmit,
  placeholder = "Message...",
  disabled = false,
  className,
  mode = "chat"
}: PromptBoxProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [selectedTool, setSelectedTool] = React.useState<string | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);
  const [isImageDialogOpen, setIsImageDialogOpen] = React.useState(false);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [value]);

  const activeTool = selectedTool ? toolsList.find((tool) => tool.id === selectedTool) : null;
  const hasValue = value.trim().length > 0 || Boolean(imagePreview);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file?.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
    event.target.value = "";
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasValue || disabled) {
      return;
    }
    onSubmit();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "promptbox-tailwind flex flex-col rounded-[28px] border border-black/10 bg-white/90 p-2 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-[#2b2b2b]",
        className
      )}
    >
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      {imagePreview ? (
        <Dialog open={isImageDialogOpen} onOpenChange={setIsImageDialogOpen}>
          <div className="relative mb-2 w-fit rounded-2xl px-1 pt-1">
            <button type="button" className="overflow-hidden rounded-2xl" onClick={() => setIsImageDialogOpen(true)}>
              <img src={imagePreview} alt="Image preview" className="h-16 w-16 rounded-2xl object-cover" />
            </button>
            <button
              type="button"
              onClick={() => setImagePreview(null)}
              className="absolute right-2 top-2 rounded-full bg-black/40 p-1 text-white transition hover:bg-black/60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <DialogContent>
            <img src={imagePreview} alt="Full preview" className="max-h-[88vh] w-full rounded-[24px] object-contain" />
          </DialogContent>
        </Dialog>
      ) : null}

      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="min-h-12 w-full resize-none border-0 bg-transparent px-3 py-3 text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none"
      />

      <div className="flex items-center gap-2 px-1 pb-1">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text)] transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                <Plus className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent showArrow>
              <p>Attach image</p>
            </TooltipContent>
          </Tooltip>

          {mode === "chat" ? (
            <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-9 items-center gap-2 rounded-full px-3 text-sm text-[var(--text)] transition hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <Sparkles className="h-4 w-4" />
                      {!activeTool ? "Tools" : activeTool.shortName}
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent showArrow>
                  <p>Tools</p>
                </TooltipContent>
              </Tooltip>
              <PopoverContent>
                <div className="flex flex-col gap-1">
                  {toolsList.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => {
                          setSelectedTool(tool.id);
                          setIsPopoverOpen(false);
                        }}
                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <Icon className="h-4 w-4" />
                        <span>{tool.name}</span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}

          {activeTool ? (
            <button
              type="button"
              onClick={() => setSelectedTool(null)}
              className="flex h-9 items-center gap-2 rounded-full bg-[#e9f4ff] px-3 text-sm text-[#1877f2] transition hover:bg-[#d7ecff] dark:bg-[#1a3656] dark:text-[#99ceff] dark:hover:bg-[#224268]"
            >
              <activeTool.icon className="h-4 w-4" />
              {activeTool.shortName}
              <X className="h-4 w-4" />
            </button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text)] transition hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <Mic className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent showArrow>
                <p>Voice input</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="submit"
                  disabled={!hasValue || disabled}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-white transition hover:bg-black/80 disabled:cursor-not-allowed disabled:bg-black/30 dark:bg-white dark:text-black dark:hover:bg-white/80 dark:disabled:bg-white/30"
                >
                  <Send className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent showArrow>
                <p>Send</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </form>
  );
}
