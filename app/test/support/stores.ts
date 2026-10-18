// The Zustand stores (DEC-021) are module singletons: each test starts from their initial state,
// as it did with a freshly mounted provider.
import { useCart } from '@/lib/store/cart';
import { usePanel } from '@/lib/store/panel';
import { useSession } from '@/lib/store/session';

export function resetStores() {
  useCart.setState(useCart.getInitialState(), true);
  usePanel.setState(usePanel.getInitialState(), true);
  useSession.setState(useSession.getInitialState(), true);
}
