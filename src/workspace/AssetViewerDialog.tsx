import type { Asset, Editor } from '../editor';
import { AssetClipsDialog } from './AssetClipsDialog';

export default function AssetViewerDialog(props: {
  editor: Editor;
  asset: Asset;
  readOnly: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | false;
}) {
  return <AssetClipsDialog {...props} />;
}
