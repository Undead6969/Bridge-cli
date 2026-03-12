declare module "localtunnel" {
  type LocalTunnelOptions = {
    port: number;
    subdomain?: string;
  };

  type LocalTunnelInstance = {
    url: string;
    close: () => void;
  };

  export default function localtunnel(options: LocalTunnelOptions): Promise<LocalTunnelInstance>;
}
