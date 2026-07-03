import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Frame } from "../types";

interface Props {
  frame: Frame;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

export function SortableThumb({
  frame,
  index,
  selected,
  onSelect,
  onRemove,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: frame.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`thumb ${selected ? "thumb--selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      {...attributes}
      {...listeners}
    >
      <img src={frame.url} alt={frame.name} draggable={false} />
      <span className="thumb__index">{index + 1}</span>
      <button
        className="thumb__remove"
        title="Remove"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ×
      </button>
    </div>
  );
}
