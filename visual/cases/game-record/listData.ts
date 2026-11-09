/** 新旧战绩分页共同使用的固定房间名称期望。 */
export const pagedRoomNames = Array.from({ length: 17 }, /** 为当前索引构造`Paged Texas ${String(index + 1).padStart(2, '0')}`。
 * @param _ - 当前操作使用的 _。
 * @param index - 当前条目在集合中的位置。 */ (_, index) =>
  `Paged Texas ${String(index + 1).padStart(2, '0')}`);
