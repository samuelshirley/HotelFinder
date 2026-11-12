import { Checkout } from '@/components/Checkout';

export default function Page({ params }: { params: { id: string } }) {
  return <Checkout bookingId={params.id} />;
}
