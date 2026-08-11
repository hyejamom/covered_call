import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react'

interface RenameInputProps {
    className: string
    /** 편집 시작 시점의 이름 — 비제어 입력이라 초기값으로만 쓰인다 */
    defaultValue: string
    maxLength: number
    onCommit: (name: string) => void
    onCancel: () => void
}

/**
 * 이름 편집용 입력창 — 워크북/탭 공용
 * 비제어(defaultValue) 방식이라 입력값을 상태로 들지 않는다.
 * Enter/포커스 이탈로 확정, Escape로 취소.
 */
function RenameInput(props: RenameInputProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const inputRef = useRef<HTMLInputElement>(null)
    const cancelledRef = useRef<boolean>(false)   // Escape 취소 직후의 blur 가 값을 확정하지 못하게 막는 플래그

    // ┣━━━━━━━━━━━━━━━━ Effects ━━━━━━━━━━━━━━━━━━━━┫
    useEffect(() => {
        // 마운트 직후 포커스 + 전체 선택 (DOM 조작이므로 상태 갱신 없음)
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [])

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 키 입력 — @param event Enter는 확정, Escape는 취소 */
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') props.onCommit(event.currentTarget.value)
        if (event.key === 'Escape') {
            cancelledRef.current = true
            props.onCancel()
        }
    }

    /** 포커스 이탈 — @param event 취소로 빠져나온 경우가 아니면 값 확정 */
    const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
        if (cancelledRef.current) return
        props.onCommit(event.target.value)
    }

    return (
        <input
            ref={inputRef}
            className={props.className}
            defaultValue={props.defaultValue}
            maxLength={props.maxLength}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
        />
    )
}

export default RenameInput