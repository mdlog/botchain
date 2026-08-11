/** BotCompute brand logo. Sized via the `size` prop (px). Used in the sidebar
 *  header and the mobile top bar. The asset lives at /botcompute.png (built by
 *  setup.sh from new-logo.png into public/). */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/botcompute.png"
      alt="BotCompute"
      width={size}
      height={size}
      className="rounded-lg object-contain"
      style={{ height: size, width: size }}
    />
  );
}
